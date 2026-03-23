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

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 800

  let result: { status: 'cache_empty' } | { status: 'token_missing' } | { status: 'ok'; token: string } = { status: 'cache_empty' }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    result = await handle.page.evaluate(
    (args: { chunkGlobal: string; moduleTest: string; call: string }) => {
      const wp = (window as Record<string, unknown>)[args.chunkGlobal] as
        | Array<unknown>
        | undefined
      if (!wp || !Array.isArray(wp)) {
        return { status: 'cache_empty' as const }
      }

      let found: string | null = null
      let sawModules = false
      wp.push([
        [Symbol()],
        {},
        (r: { c?: Record<string, { exports?: Record<string, unknown> }> }) => {
          sawModules = Object.keys(r.c ?? {}).length > 0
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
      if (!sawModules) {
        return { status: 'cache_empty' as const }
      }
      if (!found) {
        return { status: 'token_missing' as const }
      }
      return { status: 'ok' as const, token: found }
    },
    { chunkGlobal: config.chunk_global, moduleTest: config.module_test, call: config.call },
  )

    if (result.status !== 'cache_empty') break
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  if (result.status === 'cache_empty') {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `webpack_module_walk: webpack cache is not ready for ${config.chunk_global}`,
      action: 'Keep the tab active until the app finishes loading, then retry.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (result.status !== 'ok') {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `webpack_module_walk: no token found via ${config.chunk_global}.${config.module_test}`,
      action: 'Ensure the site is loaded and you are logged in.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }
  const token = result.token

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

/** webpack chunk globals must be valid JS identifiers (e.g., webpackChunkdiscord_app) */
const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

function validateConfig(config: WebpackModuleWalkConfig): void {
  // chunk_global is a window property name — must be a simple identifier
  if (!IDENTIFIER_PATTERN.test(config.chunk_global)) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `webpack_module_walk: invalid chunk_global "${config.chunk_global}".`,
      action: 'chunk_global must be a valid JS identifier (e.g., webpackChunkdiscord_app).',
      retriable: false,
      failureClass: 'fatal',
    })
  }

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
        failureClass: 'fatal',
      })
    }
  }
}

import { registerResolver } from './registry.js'
registerResolver('webpack_module_walk', async (ctx, config) =>
  resolveWebpackModuleWalk(ctx.handle, config as unknown as Parameters<typeof resolveWebpackModuleWalk>[1]))
