import { OpenWebError } from '../lib/errors.js'
import type { XOpenWebServer } from '../types/extensions.js'
import type { Transport } from '../types/extensions.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'

const VALID_TRANSPORTS = new Set<string>(['node', 'page'])

/** Read x-openweb config from the server entry matching this operation */
export function getServerXOpenWeb(spec: OpenApiSpec, operation: OpenApiOperation): XOpenWebServer | undefined {
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) return undefined

  for (const server of spec.servers ?? []) {
    if (server.url === serverUrl) {
      return (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
    }
  }

  return undefined
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
