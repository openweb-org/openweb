import type { HarEntry, StateSnapshot } from '../../capture/types.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../../types/primitives.js'
import type { Transport } from '../../types/extensions.js'

export interface ExtractionSignal {
  readonly type: 'ssr_next_data' | 'script_json'
  readonly selector?: string
  readonly id?: string
  readonly dataType?: string
  readonly estimatedSize?: number
}

export interface ClassifyResult {
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive
  readonly signing?: SigningPrimitive
  readonly extractions?: readonly ExtractionSignal[]
}

export interface CaptureData {
  readonly harEntries: readonly HarEntry[]
  readonly stateSnapshots: readonly StateSnapshot[]
  readonly domHtml?: string
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Cookie name prefixes/patterns that indicate tracking/analytics, not auth. */
const TRACKING_COOKIE_PREFIXES = [
  '_ga', '_gid', '_gat', '_gcl', '_fbp', '_fbc', 'fbm_', 'fbsr_',
  'analytics', 'consent', '_hjid', '_hjSession', 'mp_', 'ajs_',
  '__utm', '_pk_', 'hubspot', '_clck', '_clsk', 'OptanonConsent',
  'CookieConsent', 'eupubconsent', '__cfduid',
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
function detectCookieSession(data: CaptureData): boolean {
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
function detectLocalStorageJwt(
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

/**
 * Detect meta_tag CSRF: a <meta name="..." content="..."> tag whose content
 * value appears in a custom header on mutation requests.
 */
function detectMetaTag(data: CaptureData): { name: string; header: string } | undefined {
  if (!data.domHtml) return undefined

  // Find <meta name="..." content="..."> tags
  const metaRegex = /<meta\s+name="([^"]+)"\s+content="([^"]+)"/gi
  const metaTags = new Map<string, string>()
  let match: RegExpExecArray | null
  while ((match = metaRegex.exec(data.domHtml)) !== null) {
    metaTags.set(match[1]!, match[2]!)
  }

  if (metaTags.size === 0) return undefined

  // Check if any meta tag value appears in mutation request headers
  const mutations = data.harEntries.filter((e) => MUTATION_METHODS.has(e.request.method))
  for (const entry of mutations) {
    for (const header of entry.request.headers) {
      const name = header.name.toLowerCase()
      if (['cookie', 'content-type', 'accept', 'user-agent', 'host', 'origin', 'referer'].includes(name)) continue

      for (const [metaName, metaValue] of metaTags) {
        if (header.value === metaValue && metaValue.length > 0) {
          return { name: metaName, header: header.name }
        }
      }
    }
  }

  return undefined
}

/**
 * Detect sapisidhash signing: Authorization header matches
 * `SAPISIDHASH <timestamp>_<40-char-hex>` pattern.
 */
function detectSapisidhash(data: CaptureData): { origin: string } | undefined {
  for (const entry of data.harEntries) {
    for (const h of entry.request.headers) {
      if (h.name.toLowerCase() === 'authorization' && /^SAPISIDHASH \d+_[0-9a-f]{40}$/.test(h.value)) {
        try {
          const origin = new URL(entry.request.url).origin
          return { origin }
        } catch {
          continue
        }
      }
    }
  }
  return undefined
}

/**
 * Detect exchange_chain: a POST to a token-like endpoint whose response
 * contains the Bearer token used in subsequent Authorization headers.
 */
function detectExchangeChain(
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
 * Detect ssr_next_data: HTML contains a `<script id="__NEXT_DATA__">` tag.
 * Returns extraction signal with estimated JSON size.
 */
function detectSsrNextData(data: CaptureData): ExtractionSignal | undefined {
  const html = data.domHtml ?? getHtmlFromHar(data)
  if (!html) return undefined

  const match = /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>/i.exec(html)
  if (!match) return undefined

  // Estimate payload size from closing tag position
  const startIdx = match.index + match[0].length
  const endIdx = html.indexOf('</script>', startIdx)
  const estimatedSize = endIdx > startIdx ? endIdx - startIdx : 0

  return { type: 'ssr_next_data', selector: 'script#__NEXT_DATA__', estimatedSize }
}

/**
 * Detect script_json: HTML contains `<script type="application/json">` tags
 * (excluding __NEXT_DATA__ which is handled separately).
 * Returns all detected script_json signals.
 */
function detectScriptJson(data: CaptureData): ExtractionSignal[] {
  const html = data.domHtml ?? getHtmlFromHar(data)
  if (!html) return []

  const signals: ExtractionSignal[] = []
  const regex = /<script\s+([^>]*)type="application\/json"([^>]*)>/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1]! + match[2]!

    // Skip __NEXT_DATA__ — handled by detectSsrNextData
    if (/id="__NEXT_DATA__"/i.test(attrs)) continue

    const idMatch = /id="([^"]+)"/i.exec(attrs)
    const dataTargetMatch = /data-target="([^"]+)"/i.exec(attrs)

    const startIdx = match.index + match[0].length
    const endIdx = html.indexOf('</script>', startIdx)
    const estimatedSize = endIdx > startIdx ? endIdx - startIdx : 0

    // Only report tags with non-trivial content
    if (estimatedSize < 10) continue

    signals.push({
      type: 'script_json',
      id: idMatch?.[1] ?? undefined,
      selector: idMatch?.[1] ? `script#${idMatch[1]}` : (dataTargetMatch?.[1] ? `script[data-target="${dataTargetMatch[1]}"]` : undefined),
      dataType: dataTargetMatch?.[1] ?? undefined,
      estimatedSize,
    })
  }

  return signals
}

/** Extract HTML from HAR entries (for sites where domHtml isn't provided separately). */
function getHtmlFromHar(data: CaptureData): string | undefined {
  for (const entry of data.harEntries) {
    if (
      entry.request.method === 'GET' &&
      entry.response.status === 200 &&
      entry.response.content.mimeType.includes('text/html') &&
      entry.response.content.text
    ) {
      return entry.response.content.text
    }
  }
  return undefined
}

/**
 * Classify capture data to detect L2 primitives.
 * Returns mode + auth + csrf + signing configuration for x-openweb emission.
 *
 * Auth priority: localStorage_jwt > exchange_chain > cookie_session
 */
export function classify(data: CaptureData): ClassifyResult {
  const localStorageJwt = detectLocalStorageJwt(data)
  const exchangeChain = detectExchangeChain(data)
  const hasCookieSession = detectCookieSession(data)
  const cookieToHeader = detectCookieToHeader(data)
  const metaTag = detectMetaTag(data)
  const sapisidhash = detectSapisidhash(data)

  // Detect extraction patterns
  const extractionSignals: ExtractionSignal[] = []
  const ssrNextData = detectSsrNextData(data)
  if (ssrNextData) extractionSignals.push(ssrNextData)
  extractionSignals.push(...detectScriptJson(data))
  const extractions = extractionSignals.length > 0 ? extractionSignals : undefined

  // Build signing primitive if detected
  const signing: SigningPrimitive | undefined = sapisidhash
    ? { type: 'sapisidhash', origin: sapisidhash.origin, inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' } }
    : undefined

  // Priority: localStorage_jwt > exchange_chain > cookie_session
  let auth: AuthPrimitive | undefined
  if (localStorageJwt) {
    auth = {
      type: 'localStorage_jwt',
      key: localStorageJwt.key,
      path: localStorageJwt.path,
      inject: localStorageJwt.inject,
    }
  } else if (exchangeChain) {
    auth = {
      type: 'exchange_chain',
      steps: exchangeChain.steps.map(s => ({ call: s.call, extract: s.extract })),
      inject: exchangeChain.inject,
    }
  } else if (hasCookieSession) {
    auth = { type: 'cookie_session' }
  }

  if (!auth) {
    if (signing) {
      return { transport: 'node', signing, extractions }
    }
    return { transport: 'node', extractions }
  }

  // Prefer cookie_to_header over meta_tag if both detected
  const csrf = cookieToHeader
    ? { type: 'cookie_to_header' as const, cookie: cookieToHeader.cookie, header: cookieToHeader.header }
    : metaTag
      ? { type: 'meta_tag' as const, name: metaTag.name, header: metaTag.header }
      : undefined

  return {
    transport: 'node',
    auth,
    csrf,
    signing,
    extractions,
  }
}
