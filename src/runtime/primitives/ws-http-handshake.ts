import type { WsHttpHandshake } from '../../types/ws-primitives.js'
import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
import { registerWsResolver } from './ws-registry.js'
import type { WsAuthResult, WsResolverContext } from './ws-registry.js'

export async function resolveWsHttpHandshake(
  config: WsHttpHandshake,
  ctx: WsResolverContext,
): Promise<WsAuthResult> {
  const fetchFn = ctx.fetchImpl ?? globalThis.fetch

  if (ctx.ssrfValidator) {
    await ctx.ssrfValidator(config.endpoint)
  }

  const headers: Record<string, string> = {}
  if (ctx.httpAuth?.headers) {
    Object.assign(headers, ctx.httpAuth.headers)
  }
  if (ctx.httpAuth?.cookieString) {
    headers['Cookie'] = ctx.httpAuth.cookieString
  }

  const resp = await fetchFn(config.endpoint, { method: config.method, headers })

  if (!resp.ok) {
    const is5xx = resp.status >= 500
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `WS handshake endpoint returned ${resp.status}: ${config.endpoint}`,
      action: is5xx
        ? 'Server error — retry after a delay.'
        : 'Verify the endpoint URL and authentication.',
      retriable: is5xx,
      failureClass: is5xx ? 'retriable' : 'fatal',
    })
  }

  const body = await resp.json()
  const wsUrl = getValueAtPath(body, config.url_path)

  if (typeof wsUrl !== 'string') {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `WS URL not found at path "${config.url_path}" in handshake response`,
      action: 'Verify the url_path in the WS auth config.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return { type: 'url', url: wsUrl }
}

registerWsResolver('ws_http_handshake', async (config, ctx) =>
  resolveWsHttpHandshake(config as WsHttpHandshake, ctx))
