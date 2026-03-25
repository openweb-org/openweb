import type { WsUrlToken } from '../../types/ws-primitives.js'
import { OpenWebError } from '../../lib/errors.js'
import { registerWsResolver } from './ws-registry.js'
import type { WsAuthResult, WsResolverContext } from './ws-registry.js'

export function resolveWsUrlToken(
  config: WsUrlToken,
  ctx: WsResolverContext,
): WsAuthResult {
  const token = config.token_source === 'http_auth'
    ? ctx.httpAuth?.token
    : (ctx.params.token as string | undefined)

  if (!token) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `No token available for WS URL token (source: ${config.token_source})`,
      action: config.token_source === 'http_auth'
        ? 'Ensure HTTP auth is resolved first.'
        : 'Provide token in params.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  const url = new URL(ctx.url)
  url.searchParams.set(config.param, token)

  return { type: 'url', url: url.toString() }
}

registerWsResolver('ws_url_token', async (config, ctx) =>
  resolveWsUrlToken(config as WsUrlToken, ctx))
