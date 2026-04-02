import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'
import type { XOpenWebServer } from '../types/extensions.js'
import type { Transport } from '../types/extensions.js'

const VALID_TRANSPORTS = new Set<string>(['node', 'page'])

/** Read x-openweb config from the server entry matching this operation,
 *  then merge operation-level overrides (auth, csrf, signing can be
 *  set or disabled per-operation via `x-openweb` on the operation). */
export function getServerXOpenWeb(spec: OpenApiSpec, operation: OpenApiOperation): XOpenWebServer | undefined {
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) return undefined

  let serverExt: XOpenWebServer | undefined

  // Check operation-level servers first (operation overrides spec)
  for (const server of operation.servers ?? []) {
    if (server.url === serverUrl) {
      serverExt = (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
      break
    }
  }

  if (!serverExt) {
    for (const server of spec.servers ?? []) {
      if (server.url === serverUrl) {
        serverExt = (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
        break
      }
    }
  }

  if (!serverExt) return undefined

  // Merge operation-level x-openweb overrides (auth, csrf, signing)
  // Setting `auth: false` at op level disables auth for that op.
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  if (!opExt) return serverExt

  const merged = { ...serverExt }
  if ('auth' in opExt) (merged as Record<string, unknown>).auth = opExt.auth || undefined
  if ('csrf' in opExt) (merged as Record<string, unknown>).csrf = opExt.csrf || undefined
  if ('signing' in opExt) (merged as Record<string, unknown>).signing = opExt.signing || undefined
  return merged as XOpenWebServer
}

/** Determine transport: operation-level overrides server-level, default node */
export function resolveTransport(spec: OpenApiSpec, operation: OpenApiOperation): Transport {
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  if (opExt?.transport) {
    const t = opExt.transport as string
    if (!VALID_TRANSPORTS.has(t)) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unknown transport: ${t}`,
        action: 'Valid transports: node, page.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    return t as Transport
  }

  const serverExt = getServerXOpenWeb(spec, operation)
  const serverTransport = serverExt?.transport ?? 'node'
  if (!VALID_TRANSPORTS.has(serverTransport)) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unknown transport: ${serverTransport}`,
      action: 'Valid transports: node, page.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return serverTransport as Transport
}
