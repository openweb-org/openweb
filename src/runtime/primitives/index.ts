// Barrel import — triggers self-registration of all resolvers
import './cookie-session.js'
import './localstorage-jwt.js'
import './sessionstorage-msal.js'
import './page-global.js'
import './webpack-module-walk.js'
import './exchange-chain.js'
import './cookie-to-header.js'
import './meta-tag.js'
import './api-response.js'
import './sapisidhash.js'

// WS auth primitives — self-register on import
import './ws-upgrade-header.js'
import './ws-first-message.js'
import './ws-url-token.js'
import './ws-http-handshake.js'

import { OpenWebError } from '../../lib/errors.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../../types/primitives.js'
import { getResolver } from './registry.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

/** Auth resolution result — extends ResolvedInjections with optional query params */
interface AuthResult extends ResolvedInjections {
  readonly queryParams?: Readonly<Record<string, string>>
}

interface PrimitiveDeps {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
  readonly authHeaders?: Record<string, string>
  readonly cookieString?: string
}

/** Resolve auth primitive via registry */
export async function resolveAuth(
  handle: BrowserHandle,
  auth: AuthPrimitive,
  serverUrl: string,
  deps?: PrimitiveDeps,
): Promise<AuthResult> {
  const resolver = getResolver(auth.type)
  if (!resolver) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unsupported auth primitive: ${auth.type}`,
      action: 'This auth type is not yet implemented.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return resolver(
    { handle, serverUrl, deps: { fetchImpl: deps?.fetchImpl, ssrfValidator: deps?.ssrfValidator } },
    auth as unknown as Record<string, unknown>,
  )
}

/** Resolve CSRF primitive via registry */
export async function resolveCsrf(
  handle: BrowserHandle,
  csrf: CsrfPrimitive,
  serverUrl: string,
  deps?: PrimitiveDeps,
): Promise<ResolvedInjections> {
  const resolver = getResolver(csrf.type)
  if (!resolver) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unsupported CSRF primitive: ${csrf.type}`,
      action: 'This CSRF type is not yet implemented.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return resolver(
    { handle, serverUrl, deps: { fetchImpl: deps?.fetchImpl, authHeaders: deps?.authHeaders, cookieString: deps?.cookieString } },
    csrf as unknown as Record<string, unknown>,
  )
}

/** Resolve signing primitive via registry */
export async function resolveSigning(
  handle: BrowserHandle,
  signing: SigningPrimitive,
  serverUrl: string,
): Promise<ResolvedInjections> {
  const resolver = getResolver(signing.type)
  if (!resolver) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unsupported signing primitive: ${signing.type}`,
      action: 'This signing type is not yet implemented.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return resolver(
    { handle, serverUrl },
    signing as unknown as Record<string, unknown>,
  )
}

export { registerResolver, getResolver } from './registry.js'
export type { ResolverFn, ResolverContext, ResolverResult } from './registry.js'
export type { BrowserHandle, ResolvedInjections } from './types.js'
export { registerWsResolver, getWsResolver, resolveWsAuth } from './ws-registry.js'
export type { WsResolverFn, WsResolverContext, WsAuthResult } from './ws-registry.js'
