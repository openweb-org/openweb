import { createHash } from 'node:crypto'

import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface SapisidhashConfig {
  readonly cookie?: string // defaults to 'SAPISID'
  readonly origin: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
  }
}

/**
 * Resolve sapisidhash signing: read SAPISID cookie, compute SHA-1 signature,
 * and inject as Authorization header.
 *
 * Algorithm: SAPISIDHASH ${timestamp}_${SHA1(timestamp + " " + SAPISID + " " + origin)}
 */
export async function resolveSapisidhash(
  handle: BrowserHandle,
  config: SapisidhashConfig,
  serverUrl: string,
): Promise<ResolvedInjections> {
  const cookieName = config.cookie ?? 'SAPISID'

  // Get SAPISID cookie from browser context
  const cookies = await handle.context.cookies(serverUrl)
  const sapisidCookie = cookies.find((c) => c.name === cookieName)

  if (!sapisidCookie) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `Cookie "${cookieName}" not found. Ensure you are logged in to Google.`,
      action: 'Log in to the site in Chrome and retry.',
      retriable: true,
    })
  }

  const sapisid = sapisidCookie.value
  const timestamp = Math.floor(Date.now() / 1000)
  const hash = computeSapisidhash(timestamp, sapisid, config.origin)

  const headerValue = (config.inject.prefix ?? '') + `${timestamp}_${hash}`
  const headers: Record<string, string> = {}
  if (config.inject.header) {
    headers[config.inject.header] = headerValue
  }

  return { headers }
}

/**
 * Compute SAPISIDHASH: SHA1(timestamp + " " + SAPISID + " " + origin)
 * Exported for testing.
 */
export function computeSapisidhash(timestamp: number, sapisid: string, origin: string): string {
  const input = `${timestamp} ${sapisid} ${origin}`
  return createHash('sha1').update(input).digest('hex')
}
