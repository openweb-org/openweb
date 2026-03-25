import type { WsFirstMessage } from '../../types/ws-primitives.js'
import { OpenWebError } from '../../lib/errors.js'
import { setValueAtPath } from '../value-path.js'
import { registerWsResolver } from './ws-registry.js'
import type { WsAuthResult, WsResolverContext } from './ws-registry.js'

export function resolveWsFirstMessage(
  config: WsFirstMessage,
  ctx: WsResolverContext,
): WsAuthResult {
  const token = config.token_source === 'http_auth'
    ? ctx.httpAuth?.token
    : (ctx.params.token as string | undefined)

  if (!token) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `No token available for WS first message (source: ${config.token_source})`,
      action: config.token_source === 'http_auth'
        ? 'Ensure HTTP auth is resolved first.'
        : 'Provide token in params.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  const payload = setValueAtPath(
    { ...config.discriminator } as Record<string, unknown>,
    config.token_path,
    token,
  )

  return { type: 'first_message', payload }
}

registerWsResolver('ws_first_message', async (config, ctx) =>
  resolveWsFirstMessage(config as WsFirstMessage, ctx))
