import type { CaptureData } from './classify.js'

/** Cookie name prefixes/patterns that indicate tracking/analytics, not auth. */
const TRACKING_COOKIE_PREFIXES = [
  // Google
  '_ga', '_gid', '_gat', '_gcl', '__utm', 'NID', '1P_JAR', 'APISID', 'HSID', 'SSID', 'SID',
  'SAPISID', 'SIDCC', '__Secure-1P', '__Secure-3P',
  // Facebook / Meta
  '_fbp', '_fbc', 'fbm_', 'fbsr_', 'datr', 'sb',
  // Cloudflare
  '__cf_bm', '__cfruid', '__cfduid', 'cf_clearance',
  // Analytics / tracking
  'analytics', '_hjid', '_hjSession', 'mp_', 'ajs_', '_pk_', 'hubspot',
  '_clck', '_clsk', 'posthog', 'ph_', '_dd_s',
  // Consent
  'consent', 'OptanonConsent', 'CookieConsent', 'eupubconsent', 'cookieyes',
  // Twitter / X
  'twid', 'guest_id', 'personalization_id', 'ct0',
]

function isTrackingCookie(name: string): boolean {
  const lower = name.toLowerCase()
  return TRACKING_COOKIE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))
}

/**
 * Detect cookie_session: all API requests carry Cookie headers,
 * and at least one non-tracking snapshot cookie name appears in the request
 * Cookie headers.
 */
export function detectCookieSession(data: CaptureData): boolean {
  if (data.harEntries.length === 0 || data.stateSnapshots.length === 0) {
    return false
  }

  const snapshotCookieNames = new Set<string>()
  for (const snapshot of data.stateSnapshots) {
    for (const cookie of snapshot.cookies) {
      if (!isTrackingCookie(cookie.name)) {
        snapshotCookieNames.add(cookie.name)
      }
    }
  }

  if (snapshotCookieNames.size === 0) return false

  // Check: do all HAR entries have Cookie headers with at least one non-tracking snapshot cookie?
  for (const entry of data.harEntries) {
    const cookieHeader = entry.request.headers.find((h) => h.name.toLowerCase() === 'cookie')
    if (!cookieHeader) return false

    const requestCookieNames = cookieHeader.value.split(';').map((c) => c.trim().split('=')[0]!)
    const hasOverlap = requestCookieNames.some(
      (name) => snapshotCookieNames.has(name) && !isTrackingCookie(name),
    )
    if (!hasOverlap) return false
  }

  return true
}

/**
 * Recursively search a parsed object for a string value that appears in
 * one of the Authorization header values from HAR entries.
 */
function findTokenInObject(
  obj: unknown,
  authValues: string[],
  currentPath = '',
): { path: string; prefix: string } | undefined {
  if (typeof obj === 'string' && obj.length > 20) {
    for (const authValue of authValues) {
      if (authValue.includes(obj)) {
        const prefix = authValue.slice(0, authValue.indexOf(obj))
        return { path: currentPath, prefix }
      }
    }
  }

  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const result = findTokenInObject(value, authValues, currentPath ? `${currentPath}.${key}` : key)
      if (result) return result
    }
  }

  return undefined
}

/**
 * Detect localStorage_jwt: a localStorage value, parsed as JSON and traversed,
 * contains a string that appears in an Authorization header from HAR entries.
 */
export function detectLocalStorageJwt(
  data: CaptureData,
): { key: string; path: string; inject: { header: string; prefix: string } } | undefined {
  if (data.stateSnapshots.length === 0) return undefined

  // Collect all Authorization header values from HAR entries
  const authValues: string[] = []
  for (const entry of data.harEntries) {
    for (const h of entry.request.headers) {
      if (h.name.toLowerCase() === 'authorization') {
        authValues.push(h.value)
      }
    }
  }
  if (authValues.length === 0) return undefined

  // Check localStorage entries for JWT tokens matching Authorization headers
  for (const snapshot of data.stateSnapshots) {
    for (const [key, rawValue] of Object.entries(snapshot.localStorage)) {
      if (!rawValue) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(rawValue) as unknown
      } catch {
        // intentional: non-JSON localStorage value — skip
        continue
      }

      // Search for string values in the parsed object that match auth headers
      const match = findTokenInObject(parsed, authValues)
      if (match) {
        return {
          key,
          path: match.path,
          inject: { header: 'Authorization', prefix: match.prefix },
        }
      }
    }
  }

  return undefined
}

/** Recursively search an object for a target string value, returning the dot-path. */
function findValueInObject(obj: unknown, target: string, path = ''): string | undefined {
  if (typeof obj === 'string' && obj === target) return path
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const result = findValueInObject(value, target, path ? `${path}.${key}` : key)
      if (result) return result
    }
  }
  return undefined
}

/**
 * Detect exchange_chain: a POST to a token-like endpoint whose response
 * contains the Bearer token used in subsequent Authorization headers.
 */
export function detectExchangeChain(
  data: CaptureData,
): { steps: Array<{ call: string; extract: string }>; inject: { header: string; prefix: string } } | undefined {
  // Look for Bearer token in Authorization headers
  const bearerEntries = data.harEntries.filter(e =>
    e.request.headers.some(h => h.name.toLowerCase() === 'authorization' && h.value.startsWith('Bearer ')),
  )
  if (bearerEntries.length === 0) return undefined

  // Look for token exchange endpoints (POST requests to URLs containing 'token')
  const tokenEndpoints = data.harEntries.filter(e =>
    e.request.method === 'POST' &&
    /token/i.test(e.request.url) &&
    e.response.status === 200,
  )
  if (tokenEndpoints.length === 0) return undefined

  // Check if the token endpoint response contains the bearer token used in subsequent requests
  for (const tokenEntry of tokenEndpoints) {
    if (!tokenEntry.response.content?.text) continue
    let responseData: Record<string, unknown>
    try {
      responseData = JSON.parse(tokenEntry.response.content.text) as Record<string, unknown>
    } catch {
      // intentional: non-JSON token response — skip endpoint
      continue
    }
    for (const bearerEntry of bearerEntries) {
      const authHeader = bearerEntry.request.headers.find(h => h.name.toLowerCase() === 'authorization')
      if (!authHeader) continue
      const token = authHeader.value.replace('Bearer ', '')

      // Check if the token appears in the response data
      const extractPath = findValueInObject(responseData, token)
      if (extractPath) {
        return {
          steps: [{ call: tokenEntry.request.url, extract: extractPath }],
          inject: { header: 'Authorization', prefix: 'Bearer ' },
        }
      }
    }
  }

  return undefined
}
