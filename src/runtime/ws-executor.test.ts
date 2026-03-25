import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

import {
  executeWsOperation,
  streamWsOperation,
  dispatchWsOperation,
  resolveTemplate,
} from './ws-executor.js'
import { WsRouter, type WsRouterConfig } from './ws-router.js'
import type { WsConnectionManager, WsConnectionEvents } from './ws-connection.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'

// ── Mock Connection ──────────────────────────────

function createMockConnection(state: Record<string, unknown> = {}): WsConnectionManager {
  const emitter = new EventEmitter()
  const sent: unknown[] = []
  return Object.assign(emitter, {
    getState: () => 'READY' as const,
    connectionState: state,
    send(data: unknown) { sent.push(data) },
    _sent: sent,
  }) as unknown as WsConnectionManager & { _sent: unknown[] }
}

// ── Router Config ────────────────────────────────

const routerConfig: WsRouterConfig = {
  discriminator: {
    sent: { field: 'type' },
    received: { field: 'type' },
  },
  controlPatterns: [{ match: { type: 'hello' } }],
  ackPatterns: [{ match: { type: 'heartbeat_ack' } }],
  responsePattern: { correlationField: 'request_id' },
  eventRoutes: [
    { operationId: 'price_update', match: { type: 'price' } },
  ],
}

// ── Tests ────────────────────────────────────────

describe('resolveTemplate', () => {
  it('resolves constants and param bindings', () => {
    const result = resolveTemplate(
      {
        constants: { action: 'subscribe' },
        bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
      },
      { symbols: ['AAPL'] },
    )
    expect(result).toEqual({ action: 'subscribe', symbols: ['AAPL'] })
  })

  it('resolves state bindings', () => {
    const result = resolveTemplate(
      {
        constants: { op: 1 },
        bindings: [{ path: 'd', source: 'state', key: 'sequence' }],
      },
      {},
      { sequence: 42 },
    )
    expect(result).toEqual({ op: 1, d: 42 })
  })
})

describe('executeWsOperation (request/reply)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const operation: XOpenWebWsOperation = {
    permission: 'read',
    pattern: 'request_reply',
    subscribe_message: {
      constants: { type: 'request', action: 'get_user' },
      bindings: [{ path: 'request_id', source: 'param', key: 'request_id' }],
    },
    correlation: { field: 'request_id', source: 'echo' },
  }

  it('sends request and returns matching response', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const promise = executeWsOperation(conn, router, operation, { request_id: 'abc-123' })

    // Simulate response
    conn.emit('message', { type: 'response', request_id: 'abc-123', data: { name: 'Alice' } })

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.body).toEqual({ type: 'response', request_id: 'abc-123', data: { name: 'Alice' } })

    // Verify the outgoing message was sent
    const sent = (conn as unknown as { _sent: unknown[] })._sent
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ type: 'request', action: 'get_user', request_id: 'abc-123' })
  })

  it('times out if no response received', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const promise = executeWsOperation(conn, router, operation, { request_id: 'abc-123' }, { timeoutMs: 500 })

    vi.advanceTimersByTime(500)
    const result = await promise
    expect(result.status).toBe('timeout')
    expect(result.body).toBeNull()
  })

  it('ignores non-response frames', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const promise = executeWsOperation(conn, router, operation, { request_id: 'abc-123' })

    // Emit an event frame (not a response) — should be ignored
    conn.emit('message', { type: 'price', symbol: 'AAPL', price: 150 })

    // Then emit the actual response
    conn.emit('message', { type: 'response', request_id: 'abc-123', data: { name: 'Bob' } })

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.body).toEqual({ type: 'response', request_id: 'abc-123', data: { name: 'Bob' } })
  })

  it('returns error when no template defined', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const op: XOpenWebWsOperation = { permission: 'read', pattern: 'request_reply' }

    const result = await executeWsOperation(conn, router, op, {})
    expect(result.status).toBe('error')
  })
})

describe('streamWsOperation (subscribe/stream)', () => {
  const operation: XOpenWebWsOperation = {
    permission: 'read',
    pattern: 'subscribe',
    subscribe_message: {
      constants: { action: 'subscribe' },
      bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
    },
    unsubscribe_message: {
      constants: { action: 'unsubscribe' },
      bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
    },
  }

  it('yields event messages from stream', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const handle = streamWsOperation(conn, router, operation, { symbols: ['AAPL'] })

    // Verify subscribe message was sent
    const sent = (conn as unknown as { _sent: unknown[] })._sent
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ action: 'subscribe', symbols: ['AAPL'] })

    // Emit events
    conn.emit('message', { type: 'price', symbol: 'AAPL', price: 150 })
    conn.emit('message', { type: 'price', symbol: 'AAPL', price: 151 })

    const iter = handle.messages[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ type: 'price', symbol: 'AAPL', price: 150 })

    const second = await iter.next()
    expect(second.done).toBe(false)
    expect(second.value).toEqual({ type: 'price', symbol: 'AAPL', price: 151 })

    handle.close()
  })

  it('close sends unsubscribe message', () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const handle = streamWsOperation(conn, router, operation, { symbols: ['AAPL'] })
    handle.close()

    const sent = (conn as unknown as { _sent: unknown[] })._sent
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ action: 'unsubscribe', symbols: ['AAPL'] })
  })

  it('iterator completes after close', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const handle = streamWsOperation(conn, router, operation, { symbols: ['AAPL'] })
    const iter = handle.messages[Symbol.asyncIterator]()

    // Request next before close — will resolve as done
    const pending = iter.next()
    handle.close()

    const result = await pending
    expect(result.done).toBe(true)
  })

  it('filters out non-event frames', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)

    const handle = streamWsOperation(conn, router, operation, { symbols: ['AAPL'] })

    // Emit control frame (should be filtered)
    conn.emit('message', { type: 'hello', d: {} })
    // Emit ack (should be filtered)
    conn.emit('message', { type: 'heartbeat_ack' })
    // Emit event (should pass through)
    conn.emit('message', { type: 'price', symbol: 'AAPL', price: 150 })

    const iter = handle.messages[Symbol.asyncIterator]()
    const result = await iter.next()
    expect(result.value).toEqual({ type: 'price', symbol: 'AAPL', price: 150 })

    handle.close()
  })

  it('works without subscribe_message (stream pattern)', () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const streamOp: XOpenWebWsOperation = {
      permission: 'read',
      pattern: 'stream',
    }

    const handle = streamWsOperation(conn, router, streamOp, {})
    const sent = (conn as unknown as { _sent: unknown[] })._sent
    expect(sent).toHaveLength(0) // no subscribe message sent

    handle.close()
  })
})

describe('dispatchWsOperation', () => {
  it('dispatches request_reply to executeWsOperation', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const op: XOpenWebWsOperation = {
      permission: 'read',
      pattern: 'request_reply',
      subscribe_message: {
        constants: { type: 'req' },
        bindings: [{ path: 'request_id', source: 'param', key: 'request_id' }],
      },
    }

    const result = dispatchWsOperation(conn, router, op, { request_id: '1' })
    expect(result).toBeInstanceOf(Promise)

    // Send response to resolve
    conn.emit('message', { type: 'resp', request_id: '1', data: 'ok' })
    const resolved = await (result as Promise<{ status: string }>)
    expect(resolved.status).toBe('ok')
  })

  it('dispatches subscribe to streamWsOperation', () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const op: XOpenWebWsOperation = {
      permission: 'read',
      pattern: 'subscribe',
      subscribe_message: {
        constants: { action: 'sub' },
        bindings: [],
      },
    }

    const result = dispatchWsOperation(conn, router, op, {})
    expect(result).toHaveProperty('messages')
    expect(result).toHaveProperty('close')
    ;(result as { close: () => void }).close()
  })

  it('dispatches stream to streamWsOperation', () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const op: XOpenWebWsOperation = {
      permission: 'read',
      pattern: 'stream',
    }

    const result = dispatchWsOperation(conn, router, op, {})
    expect(result).toHaveProperty('messages')
    expect(result).toHaveProperty('close')
    ;(result as { close: () => void }).close()
  })

  it('dispatches publish as fire-and-forget', async () => {
    const conn = createMockConnection()
    const router = new WsRouter(routerConfig)
    const op: XOpenWebWsOperation = {
      permission: 'write',
      pattern: 'publish',
      subscribe_message: {
        constants: { type: 'chat', action: 'send' },
        bindings: [{ path: 'text', source: 'param', key: 'text' }],
      },
    }

    const result = await (dispatchWsOperation(conn, router, op, { text: 'hello' }) as Promise<{ status: string }>)
    expect(result.status).toBe('ok')
    expect(result.body).toBeNull()

    const sent = (conn as unknown as { _sent: unknown[] })._sent
    expect(sent[0]).toEqual({ type: 'chat', action: 'send', text: 'hello' })
  })
})
