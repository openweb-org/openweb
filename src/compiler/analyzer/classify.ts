import type { HarEntry, StateSnapshot } from '../../capture/types.js'
import type { AuthPrimitive, CsrfPrimitive } from '../../types/primitives.js'
import type { ExecutionMode } from '../../types/extensions.js'

export interface ClassifyResult {
  readonly mode: ExecutionMode
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive
}

export interface CaptureData {
  readonly harEntries: readonly HarEntry[]
  readonly stateSnapshots: readonly StateSnapshot[]
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Detect cookie_session: all API requests carry Cookie headers,
 * and state_snapshots contain cookies that match.
 */
function detectCookieSession(data: CaptureData): boolean {
  if (data.harEntries.length === 0 || data.stateSnapshots.length === 0) {
    return false
  }

  const snapshotCookieNames = new Set<string>()
  for (const snapshot of data.stateSnapshots) {
    for (const cookie of snapshot.cookies) {
      snapshotCookieNames.add(cookie.name)
    }
  }

  if (snapshotCookieNames.size === 0) return false

  // Check: do all HAR entries have Cookie headers?
  for (const entry of data.harEntries) {
    const hasCookie = entry.request.headers.some((h) => h.name.toLowerCase() === 'cookie')
    if (!hasCookie) return false
  }

  return true
}

/**
 * Detect cookie_to_header CSRF: for mutation requests,
 * find a header value that matches a cookie value from state_snapshots.
 */
function detectCookieToHeader(data: CaptureData): { cookie: string; header: string } | undefined {
  // Collect all cookie name→value pairs from snapshots
  const cookieValues = new Map<string, string>()
  for (const snapshot of data.stateSnapshots) {
    for (const cookie of snapshot.cookies) {
      // Only non-httpOnly cookies can be read by JS for CSRF
      if (!cookie.httpOnly) {
        cookieValues.set(cookie.name, cookie.value)
      }
    }
  }

  if (cookieValues.size === 0) return undefined

  // Find mutation requests
  const mutations = data.harEntries.filter((e) => MUTATION_METHODS.has(e.request.method))
  if (mutations.length === 0) return undefined

  // For each mutation, check if any custom header value matches a cookie value
  for (const entry of mutations) {
    for (const header of entry.request.headers) {
      const name = header.name.toLowerCase()
      // Skip standard headers
      if (['cookie', 'content-type', 'accept', 'user-agent', 'host', 'origin', 'referer'].includes(name)) continue

      for (const [cookieName, cookieValue] of cookieValues) {
        if (header.value === cookieValue && cookieValue.length > 0) {
          return { cookie: cookieName, header: header.name }
        }
      }
    }
  }

  return undefined
}

/**
 * Classify capture data to detect L2 primitives.
 * Returns mode + auth + csrf configuration for x-openweb emission.
 */
export function classify(data: CaptureData): ClassifyResult {
  const hasCookieSession = detectCookieSession(data)
  const cookieToHeader = detectCookieToHeader(data)

  if (!hasCookieSession) {
    return { mode: 'direct_http' }
  }

  return {
    mode: 'session_http',
    auth: { type: 'cookie_session' },
    csrf: cookieToHeader
      ? { type: 'cookie_to_header', cookie: cookieToHeader.cookie, header: cookieToHeader.header }
      : undefined,
  }
}
