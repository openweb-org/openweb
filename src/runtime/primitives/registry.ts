import type { BrowserHandle, ResolvedInjections } from './types.js'

/** Extended result that auth resolvers may return with query params */
export interface ResolverResult extends ResolvedInjections {
  readonly queryParams?: Readonly<Record<string, string>>
}

/** Context passed to every resolver */
export interface ResolverContext {
  readonly handle: BrowserHandle
  readonly serverUrl: string
  readonly deps: {
    readonly fetchImpl?: typeof fetch
    readonly ssrfValidator: (url: string) => Promise<void>
    readonly authHeaders?: Record<string, string>
    readonly cookieString?: string
  }
}

/** Unified resolver function signature */
export type ResolverFn = (
  ctx: ResolverContext,
  config: Record<string, unknown>,
) => Promise<ResolverResult>

const registry = new Map<string, ResolverFn>()

export function registerResolver(type: string, fn: ResolverFn): void {
  registry.set(type, fn)
}

export function getResolver(type: string): ResolverFn | undefined {
  return registry.get(type)
}
