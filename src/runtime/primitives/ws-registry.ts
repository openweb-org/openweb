import type { WsAuthConfig } from '../../types/ws-primitives.js'
import { OpenWebError } from '../../lib/errors.js'

// ── Result ───────────────────────────────────────

export type WsAuthResult =
  | { readonly type: 'headers'; readonly headers: Record<string, string> }
  | { readonly type: 'first_message'; readonly payload: Record<string, unknown> }
  | { readonly type: 'url'; readonly url: string }

// ── Context ──────────────────────────────────────

export interface WsResolverContext {
  readonly url: string
  readonly params: Record<string, unknown>
  readonly httpAuth?: {
    readonly token?: string
    readonly headers?: Record<string, string>
    readonly cookieString?: string
  }
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

// ── Registry ─────────────────────────────────────

export type WsResolverFn = (
  config: WsAuthConfig,
  ctx: WsResolverContext,
) => Promise<WsAuthResult>

const wsRegistry = new Map<string, WsResolverFn>()

export function registerWsResolver(type: string, fn: WsResolverFn): void {
  wsRegistry.set(type, fn)
}

export function getWsResolver(type: string): WsResolverFn | undefined {
  return wsRegistry.get(type)
}

export function resolveWsAuth(
  config: WsAuthConfig,
  ctx: WsResolverContext,
): Promise<WsAuthResult> {
  const resolver = getWsResolver(config.type)
  if (!resolver) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unsupported WS auth type: ${config.type}`,
      action: 'This WS auth type is not yet implemented.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return resolver(config, ctx)
}
