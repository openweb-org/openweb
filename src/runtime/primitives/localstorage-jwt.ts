import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface LocalStorageJwtConfig {
  readonly key: string
  readonly path?: string
  readonly app_path?: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
}

/**
 * Resolve localStorage_jwt: read a key from localStorage, parse JSON,
 * traverse to a path, and return as an injection (header or query param).
 *
 * When app_path is set, navigates there first to access the correct
 * localStorage origin. Supports absolute URLs (cross-domain) and
 * relative paths (same domain, different route).
 */
export async function resolveLocalStorageJwt(
  handle: BrowserHandle,
  config: LocalStorageJwtConfig,
  serverUrl?: string,
): Promise<ResolvedInjections> {
  const { key, path, inject } = config

  // Navigate to app_path if localStorage is on a different origin
  let page = handle.page
  let ownedPage = false
  if (config.app_path) {
    const appUrl = new URL(config.app_path, serverUrl).toString()
    const currentOrigin = new URL(page.url()).origin
    const targetOrigin = new URL(appUrl).origin
    if (currentOrigin !== targetOrigin) {
      page = await handle.context.newPage()
      ownedPage = true
      await page.goto(appUrl, { waitUntil: 'load', timeout: 15_000 }).catch(() => {})
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // Read from localStorage via page.evaluate
  const raw = await page.evaluate((storageKey: string) => {
    return window.localStorage.getItem(storageKey)
  }, key)

  // Clean up owned page
  if (ownedPage) await page.close().catch(() => {})

  if (!raw) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `localStorage key "${key}" not found. Ensure you are logged in.`,
      action: config.app_path
        ? `Open ${config.app_path} in the browser, log in, then retry.`
        : 'Log in to the site in Chrome and retry.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  // Parse JSON and traverse path
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    // If not JSON, use raw value directly
    value = raw
  }

  if (path) {
    const segments = path.split('.')
    for (const segment of segments) {
      if (value === null || value === undefined || typeof value !== 'object') {
        throw new OpenWebError({
          error: 'auth',
          code: 'AUTH_FAILED',
          message: `Path "${path}" not found in localStorage key "${key}".`,
          action: 'Verify the localStorage structure or re-login.',
          retriable: true,
          failureClass: 'needs_login',
        })
      }
      value = (value as Record<string, unknown>)[segment]
    }
  }

  if (!value || typeof value !== 'string') {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `No valid token found at "${key}${path ? `.${path}` : ''}".`,
      action: 'Ensure you are logged in and the token is present.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  const headers: Record<string, string> = {}
  if (inject.header) {
    headers[inject.header] = (inject.prefix ?? '') + value
  }

  return { headers }
}

import { registerResolver } from './registry.js'
registerResolver('localStorage_jwt', async (ctx, config) =>
  resolveLocalStorageJwt(ctx.handle, config as unknown as Parameters<typeof resolveLocalStorageJwt>[1], ctx.serverUrl))
