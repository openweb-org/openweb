import type { WsConnectionManager } from './ws-connection.js'
import type { WsRouter, ClassifiedFrame } from './ws-router.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'
import type { WsMessageTemplate } from '../types/ws-primitives.js'
import { getValueAtPath, setValueAtPath } from './value-path.js'
import { TIMEOUT } from '../lib/config.js'
import { randomUUID } from 'node:crypto'

// ── Types ────────────────────────────────────────

export interface WsExecuteResult {
  readonly status: 'ok' | 'timeout' | 'error'
  readonly body: unknown
}

export interface WsStreamHandle {
  readonly messages: AsyncIterable<unknown>
  readonly close: () => void
}

export interface WsExecutorConfig {
  /** Timeout for request/reply in ms. Default: TIMEOUT.ws */
  readonly timeoutMs?: number
}

// ── Template Resolution ──────────────────────────

export function resolveTemplate(
  template: WsMessageTemplate,
  params: Record<string, unknown>,
  connectionState: Record<string, unknown> = {},
): Record<string, unknown> {
  let result: Record<string, unknown> = { ...template.constants }
  for (const binding of template.bindings) {
    let value: unknown
    switch (binding.source) {
      case 'param': value = params[binding.key]; break
      case 'auth':  value = params[binding.key]; break
      case 'state': value = connectionState[binding.key]; break
    }
    result = setValueAtPath(result, binding.path, value)
  }
  return result
}

// ── Correlation Helpers ──────────────────────────

let sequenceCounter = 0

function resolveCorrelationValue(
  outgoing: Record<string, unknown>,
  operation: XOpenWebWsOperation,
): { value: unknown; outgoing: Record<string, unknown> } | undefined {
  const corr = operation.correlation
  if (!corr) return undefined

  switch (corr.source) {
    case 'echo': {
      const value = getValueAtPath(outgoing, corr.field)
      return { value, outgoing }
    }
    case 'uuid': {
      const value = randomUUID()
      return { value, outgoing: setValueAtPath(outgoing, corr.field, value) }
    }
    case 'sequence': {
      const value = ++sequenceCounter
      return { value, outgoing: setValueAtPath(outgoing, corr.field, value) }
    }
  }
}

// ── Request/Reply Executor ───────────────────────

export function executeWsOperation(
  connection: WsConnectionManager,
  router: WsRouter,
  operation: XOpenWebWsOperation,
  params: Record<string, unknown>,
  config: WsExecutorConfig = {},
): Promise<WsExecuteResult> {
  const timeoutMs = config.timeoutMs ?? TIMEOUT.ws

  const template = operation.subscribe_message
  if (!template) {
    return Promise.resolve({ status: 'error', body: 'No message template defined for operation' })
  }

  let outgoing = resolveTemplate(template, params, connection.connectionState)

  // Resolve correlation: inject ID into outgoing and track expected value
  const corr = resolveCorrelationValue(outgoing, operation)
  const expectedCorrelation = corr?.value
  if (corr) outgoing = corr.outgoing

  if (!operation.correlation && operation.pattern === 'request_reply') {
    process.stderr?.write?.(`warning: request_reply operation has no correlation config — using first-response matching\n`)
  }

  return new Promise<WsExecuteResult>((resolve) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      connection.removeListener('message', onMessage)
      resolve({ status: 'timeout', body: null })
    }, timeoutMs)

    function onMessage(data: unknown) {
      if (settled) return
      const classified = router.classify(data)
      if (classified.category !== 'response') return

      // Correlation value matching
      if (expectedCorrelation !== undefined && operation.correlation) {
        const actual = getValueAtPath(data, operation.correlation.field)
        if (actual !== expectedCorrelation) return // not our response
      }

      settled = true
      clearTimeout(timer)
      connection.removeListener('message', onMessage)
      resolve({ status: 'ok', body: classified.payload })
    }

    connection.on('message', onMessage)
    connection.send(outgoing)
  })
}

// ── Subscribe/Stream Executor ────────────────────

export function streamWsOperation(
  connection: WsConnectionManager,
  router: WsRouter,
  operation: XOpenWebWsOperation,
  params: Record<string, unknown>,
  operationId?: string,
): WsStreamHandle {
  // Send subscription message if defined
  if (operation.subscribe_message) {
    const outgoing = resolveTemplate(operation.subscribe_message, params, connection.connectionState)
    connection.send(outgoing)
  }

  let closed = false
  let pendingResolve: ((value: IteratorResult<unknown>) => void) | null = null
  const buffer: unknown[] = []

  function onMessage(data: unknown) {
    if (closed) return
    const classified = router.classify(data)
    if (classified.category !== 'event') return

    // Strict routing: only accept events for this operation
    if (operationId && classified.operationId && classified.operationId !== operationId) return
    // If operation requires routing but frame has no operationId, drop it
    if (operationId && !classified.operationId) return

    if (pendingResolve) {
      const resolve = pendingResolve
      pendingResolve = null
      resolve({ value: classified.payload, done: false })
    } else {
      buffer.push(classified.payload)
    }
  }

  connection.on('message', onMessage)

  const messages: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise<IteratorResult<unknown>>((resolve) => {
            pendingResolve = resolve
          })
        },
        return(): Promise<IteratorResult<unknown>> {
          close()
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }

  function close() {
    if (closed) return
    closed = true
    connection.removeListener('message', onMessage)

    // Send unsubscribe if defined
    if (operation.unsubscribe_message) {
      const unsub = resolveTemplate(operation.unsubscribe_message, params, connection.connectionState)
      connection.send(unsub)
    }

    // Resolve pending iterator
    if (pendingResolve) {
      const resolve = pendingResolve
      pendingResolve = null
      resolve({ value: undefined, done: true })
    }
  }

  return { messages, close }
}

// ── Pattern Dispatcher ───────────────────────────

export function dispatchWsOperation(
  connection: WsConnectionManager,
  router: WsRouter,
  operation: XOpenWebWsOperation,
  params: Record<string, unknown>,
  config: WsExecutorConfig = {},
  operationId?: string,
): Promise<WsExecuteResult> | WsStreamHandle {
  switch (operation.pattern) {
    case 'request_reply':
      return executeWsOperation(connection, router, operation, params, config)
    case 'subscribe':
    case 'stream':
      return streamWsOperation(connection, router, operation, params, operationId)
    case 'publish': {
      if (operation.subscribe_message) {
        const outgoing = resolveTemplate(operation.subscribe_message, params, connection.connectionState)
        connection.send(outgoing)
      }
      return Promise.resolve({ status: 'ok' as const, body: null })
    }
  }
}
