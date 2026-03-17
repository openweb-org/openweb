import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface LocalStorageJwtConfig {
  readonly key: string
  readonly path?: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
}

/**
 * Resolve localStorage_jwt: read a key from localStorage, parse JSON,
 * traverse to a path, and return as an injection (header or query param).
 */
export async function resolveLocalStorageJwt(
  handle: BrowserHandle,
  config: LocalStorageJwtConfig,
): Promise<ResolvedInjections> {
  const { key, path, inject } = config

  // Read from localStorage via page.evaluate
  const raw = await handle.page.evaluate((storageKey: string) => {
    return window.localStorage.getItem(storageKey)
  }, key)

  if (!raw) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `localStorage key "${key}" not found. Ensure you are logged in.`,
      action: 'Log in to the site in Chrome and retry.',
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
      message: `No valid token found at "${key}${path ? '.' + path : ''}".`,
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
  resolveLocalStorageJwt(ctx.handle, config as unknown as Parameters<typeof resolveLocalStorageJwt>[1]))
