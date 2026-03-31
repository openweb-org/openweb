import { type AsyncApiSpec, loadAsyncApi } from '../lib/asyncapi.js'
import { TIMEOUT } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'
import { type WsOperationEntry, findOperationEntry, loadSitePackage } from '../lib/site-package.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'
import type { ExecuteDependencies, ExecuteResult } from './http-executor.js'
import { type WsExecuteResult, executeWsOperation, streamWsOperation } from './ws-executor.js'
import { WsConnectionPool } from './ws-pool.js'
import { type WsRuntimeDeps, openWsSession } from './ws-runtime.js'

// ── Types ────────────────────────────────────────

export interface WsExecOptions {
  /** Max messages for stream/subscribe. Default: 1 */
  readonly wsCount?: number
  /** Timeout in ms. Default: TIMEOUT.ws */
  readonly wsTimeoutMs?: number
}

// ── Helpers ──────────────────────────────────────

function getWsOperation(asyncapi: AsyncApiSpec, operationId: string): XOpenWebWsOperation {
  const op = asyncapi.operations?.[operationId]
  if (!op) throw new Error(`WS operation not found in asyncapi: ${operationId}`)
  const ext = op['x-openweb']
  if (!ext) throw new Error(`WS operation ${operationId} missing x-openweb extension`)
  return ext
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])
}

// ── Main entry ───────────────────────────────────

export async function executeWsFromCli(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  deps?: ExecuteDependencies & WsExecOptions,
): Promise<ExecuteResult> {
  const pkg = await loadSitePackage(site)
  if (!pkg.asyncapi) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Site ${site} has no asyncapi.yaml`,
      action: 'Compile the site with WS capture first.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const pool = new WsConnectionPool()
  const wsCount = deps?.wsCount ?? 1
  const wsTimeoutMs = deps?.wsTimeoutMs ?? TIMEOUT.ws

  try {
    const session = await openWsSession(site, pkg.asyncapi, params, pool, deps)
    const { connection, router, poolKey } = session
    const operation = getWsOperation(pkg.asyncapi, operationId)

    switch (operation.pattern) {
      case 'request_reply': {
        const result = await executeWsOperation(connection, router, operation, params, { timeoutMs: wsTimeoutMs })
        pool.release(poolKey, connection)
        if (result.status === 'timeout') {
          return { status: 504, body: null, responseSchemaValid: false, responseHeaders: {} }
        }
        return { status: 200, body: result.body, responseSchemaValid: true, responseHeaders: {} }
      }

      case 'publish': {
        if (operation.subscribe_message) {
          const { resolveTemplate } = await import('./ws-executor.js')
          const outgoing = resolveTemplate(operation.subscribe_message, params, connection.connectionState)
          connection.send(outgoing)
        }
        pool.release(poolKey, connection)
        return { status: 200, body: null, responseSchemaValid: true, responseHeaders: {} }
      }

      case 'subscribe':
      case 'stream': {
        // Validate routing metadata exists
        if (!operation.event_match) {
          throw new OpenWebError({
            error: 'execution_failed',
            code: 'EXECUTION_FAILED',
            message: `Stream/subscribe operation ${operationId} has no event_match metadata — cannot route events deterministically`,
            action: 'Recompile the site to emit event_match, or add it manually to the asyncapi spec.',
            retriable: false,
            failureClass: 'fatal',
          })
        }

        const handle = streamWsOperation(connection, router, operation, params, operationId)
        const messages: unknown[] = []
        const iter = handle.messages[Symbol.asyncIterator]()

        for (let i = 0; i < wsCount; i++) {
          const next = await raceTimeout(iter.next(), wsTimeoutMs)
          if (!next || next.done) break
          messages.push(next.value)
        }

        handle.close()
        pool.release(poolKey, connection)

        const body = wsCount === 1 ? (messages[0] ?? null) : messages
        return { status: 200, body, responseSchemaValid: true, responseHeaders: {} }
      }
    }
  } catch (error) {
    pool.destroyAll()
    if (error instanceof OpenWebError) throw error
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      action: 'Check WS connection and parameters.',
      retriable: false,
      failureClass: 'fatal',
    })
  } finally {
    pool.destroyAll()
  }
}
