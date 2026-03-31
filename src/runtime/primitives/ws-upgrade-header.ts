import { OpenWebError } from '../../lib/errors.js'
import type { WsUpgradeHeader } from '../../types/ws-primitives.js'
import { registerWsResolver } from './ws-registry.js'
import type { WsAuthResult, WsResolverContext } from './ws-registry.js'

export function resolveWsUpgradeHeader(
  config: WsUpgradeHeader,
  ctx: WsResolverContext,
): WsAuthResult {
  const { inject } = config
  const token = ctx.httpAuth?.token ?? (ctx.params.token as string | undefined)

  if (!token) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: 'No token available for WS upgrade header injection',
      action: 'Ensure HTTP auth is resolved or token param is provided.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  const headerName = inject.header ?? 'Authorization'
  return { type: 'headers', headers: { [headerName]: (inject.prefix ?? '') + token } }
}

registerWsResolver('ws_upgrade_header', async (config, ctx) =>
  resolveWsUpgradeHeader(config as WsUpgradeHeader, ctx))
