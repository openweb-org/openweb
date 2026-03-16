import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface WebpackModuleWalkConfig {
  readonly chunk_global: string
  readonly module_test: string
  readonly call: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
}

/**
 * Resolve webpack_module_walk auth: push a fake module entry into the
 * webpack chunk array, walk all loaded modules looking for an export
 * matching module_test, call the matching function, and return the token.
 *
 * This MUST run in browser page context (browser_fetch mode) because the
 * webpack module cache only exists in the page's JS heap.
 */
export async function resolveWebpackModuleWalk(
  handle: BrowserHandle,
  config: WebpackModuleWalkConfig,
): Promise<ResolvedInjections & { queryParams?: Record<string, string> }> {
  validateConfig(config)

  const token = await handle.page.evaluate(
    (args: { chunkGlobal: string; moduleTest: string; call: string }) => {
      const wp = (window as Record<string, unknown>)[args.chunkGlobal] as
        | Array<unknown>
        | undefined
      if (!wp || !Array.isArray(wp)) return null

      let found: string | null = null
      wp.push([
        [Symbol()],
        {},
        (r: { c?: Record<string, { exports?: Record<string, unknown> }> }) => {
          for (const id of Object.keys(r.c ?? {})) {
            const exp = r.c![id]?.exports
            if (!exp) continue
            for (const key of ['default', 'Z', 'ZP']) {
              const mod = exp[key] as Record<string, unknown> | undefined
              if (!mod) continue
              const fn = mod[args.moduleTest]
              if (typeof fn === 'function') {
                const val = (fn as () => unknown).call(mod)
                if (typeof val === 'string' && val.length > 20) {
                  found = val
                  return
                }
              }
            }
          }
        },
      ])
      wp.pop()
      return found
    },
    { chunkGlobal: config.chunk_global, moduleTest: config.module_test, call: config.call },
  )

  if (!token) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `webpack_module_walk: no token found via ${config.chunk_global}.${config.module_test}`,
      action: 'Ensure the site is loaded and you are logged in.',
      retriable: true,
    })
  }

  const headers: Record<string, string> = {}
  const queryParams: Record<string, string> = {}

  if (config.inject.header) {
    headers[config.inject.header] = (config.inject.prefix ?? '') + token
  }
  if (config.inject.query) {
    queryParams[config.inject.query] = token
  }

  return {
    headers,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  }
}

/**
 * Minimal validation for webpack_module_walk config.
 * Unlike page_global, we do NOT block require() or module access —
 * that's the whole point of this primitive.
 */
const BLOCKED_PATTERNS = ['process.', 'child_process', 'globalThis.process']

function validateConfig(config: WebpackModuleWalkConfig): void {
  const combined = `${config.chunk_global} ${config.module_test} ${config.call}`
  const lower = combined.toLowerCase()
  for (const pattern of BLOCKED_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `webpack_module_walk: blocked pattern "${pattern}" in config.`,
        action: 'The config may have been tampered with. Re-capture the site.',
        retriable: false,
      })
    }
  }
}
