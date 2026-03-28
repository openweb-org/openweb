import { readFileSync } from 'node:fs'

import type { CaptureData } from './classify.js'
import type { AuthCandidate, AuthEvidence } from '../types-v2.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../../types/primitives.js'

// ── Tracking cookies ────────────────────────────────────────────────────────
// Prefixes/patterns that indicate tracking/analytics, NOT auth.
// ct0 and twid are intentionally excluded — they are Twitter auth cookies.
const TRACKING_COOKIE_PREFIXES: readonly string[] = JSON.parse(
  readFileSync(new URL('../../lib/config/tracking-cookies.json', import.meta.url), 'utf8'),
)

function isTrackingCookie(name: string): boolean {
  const lower = name.toLowerCase()
  return TRACKING_COOKIE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))
}

// ── Exchange chain URL pattern ──────────────────────────────────────────────
const EXCHANGE_URL_PATTERN = /(token|oauth|auth|login|session|authenticate|sso)/i

// ── Mutation methods for CSRF detection ─────────────────────────────────────
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ── Object traversal helpers ────────────────────────────────────────────────

function traverseObjectForMatch<T>(
  obj: unknown,
  matcher: (value: string, path: string) => T | undefined,
  path = '',
): T | undefined {
  if (typeof obj === 'string') {
    const result = matcher(obj, path)
    if (result) return result
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const result = traverseObjectForMatch(value, matcher, path ? `${path}.${key}` : key)
      if (result) return result
    }
  }
  return undefined
}

function findTokenInObject(
  obj: unknown,
  authValues: string[],
  currentPath = '',
): { path: string; prefix: string } | undefined {
  return traverseObjectForMatch(obj, (value, path) => {
    if (value.length <= 20) return undefined
    for (const authValue of authValues) {
      if (authValue.includes(value)) {
        return { path, prefix: authValue.slice(0, authValue.indexOf(value)) }
      }
    }
    return undefined
  }, currentPath)
}

function findValueInObject(obj: unknown, target: string, path = ''): string | undefined {
  return traverseObjectForMatch(obj, (value, p) => (value === target ? p : undefined), path)
}

// ── Internal detection results ──────────────────────────────────────────────

interface CookieSessionResult {
  matchedEntries: number
  totalEntries: number
  matchedCookies: string[]
}

interface LocalStorageJwtResult {
  key: string
  path: string
  inject: { header: string; prefix: string }
}

interface ExchangeChainResult {
  steps: Array<{ call: string; extract: string }>
  inject: { header: string; prefix: string }
  tokenEndpoints: string[]
}

interface CookieToHeaderResult {
  cookie: string
  header: string
}

interface MetaTagResult {
  name: string
  header: string
}

interface SapisidhashResult {
  origin: string
}

// ── Detection functions (reuse logic from auth-detect/csrf-detect) ──────────

function detectCookieSessionWithCoverage(data: CaptureData): CookieSessionResult | undefined {
  if (data.harEntries.length === 0 || data.stateSnapshots.length === 0) return undefined

  const snapshotCookieNames = new Set<string>()
  for (const snapshot of data.stateSnapshots) {
    for (const cookie of snapshot.cookies) {
      if (!isTrackingCookie(cookie.name)) {
        snapshotCookieNames.add(cookie.name)
      }
    }
  }
  if (snapshotCookieNames.size === 0) return undefined

  let matchedEntries = 0
  const allMatchedCookies = new Set<string>()

  for (const entry of data.harEntries) {
    const cookieHeader = entry.request.headers.find((h) => h.name.toLowerCase() === 'cookie')
    if (!cookieHeader) continue

    const requestCookieNames = cookieHeader.value.split(';').map((c) => c.trim().split('=')[0] ?? '')
    const overlapping = requestCookieNames.filter(
      (name) => snapshotCookieNames.has(name) && !isTrackingCookie(name),
    )
    if (overlapping.length > 0) {
      matchedEntries++
      for (const name of overlapping) allMatchedCookies.add(name)
    }
  }

  if (matchedEntries === 0) return undefined

  return {
    matchedEntries,
    totalEntries: data.harEntries.length,
    matchedCookies: [...allMatchedCookies],
  }
}

function detectLocalStorageJwtWithEvidence(data: CaptureData): LocalStorageJwtResult | undefined {
  if (data.stateSnapshots.length === 0) return undefined

  const authValues: string[] = []
  for (const entry of data.harEntries) {
    for (const h of entry.request.headers) {
      if (h.name.toLowerCase() === 'authorization') {
        authValues.push(h.value)
      }
    }
  }
  if (authValues.length === 0) return undefined

  for (const snapshot of data.stateSnapshots) {
    for (const [key, rawValue] of Object.entries(snapshot.localStorage)) {
      if (!rawValue) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(rawValue) as unknown
      } catch {
        continue
      }
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

function detectExchangeChainWithEvidence(data: CaptureData): ExchangeChainResult | undefined {
  const bearerEntries = data.harEntries.filter(e =>
    e.request.headers.some(h => h.name.toLowerCase() === 'authorization' && h.value.startsWith('Bearer ')),
  )
  if (bearerEntries.length === 0) return undefined

  const tokenEndpoints = data.harEntries.filter(e =>
    e.request.method === 'POST' &&
    EXCHANGE_URL_PATTERN.test(e.request.url) &&
    e.response.status === 200,
  )
  if (tokenEndpoints.length === 0) return undefined

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
      const extractPath = findValueInObject(responseData, token)
      if (extractPath) {
        return {
          steps: [{ call: tokenEntry.request.url, extract: extractPath }],
          inject: { header: 'Authorization', prefix: 'Bearer ' },
          tokenEndpoints: [tokenEntry.request.url],
        }
      }
    }
  }
  return undefined
}

function detectCookieToHeaderEvidence(data: CaptureData): CookieToHeaderResult | undefined {
  const cookieValues = new Map<string, string>()
  for (const snapshot of data.stateSnapshots) {
    for (const cookie of snapshot.cookies) {
      if (!cookie.httpOnly) {
        cookieValues.set(cookie.name, cookie.value)
      }
    }
  }
  if (cookieValues.size === 0) return undefined

  const mutations = data.harEntries.filter((e) => MUTATION_METHODS.has(e.request.method))
  if (mutations.length === 0) return undefined

  for (const entry of mutations) {
    for (const header of entry.request.headers) {
      const name = header.name.toLowerCase()
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

function detectMetaTagEvidence(data: CaptureData): MetaTagResult | undefined {
  if (!data.domHtml) return undefined

  const metaRegex = /<meta\s+name="([^"]+)"\s+content="([^"]+)"/gi
  const metaTags = new Map<string, string>()
  for (let match = metaRegex.exec(data.domHtml); match !== null; match = metaRegex.exec(data.domHtml)) {
    metaTags.set(match[1] ?? '', match[2] ?? '')
  }
  if (metaTags.size === 0) return undefined

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

function detectSapisidhashEvidence(data: CaptureData): SapisidhashResult | undefined {
  for (const entry of data.harEntries) {
    for (const h of entry.request.headers) {
      if (h.name.toLowerCase() === 'authorization' && /^SAPISIDHASH \d+_[0-9a-f]{40}$/.test(h.value)) {
        try {
          const origin = new URL(entry.request.url).origin
          return { origin }
        } catch {
          // intentional: malformed URL — skip
        }
      }
    }
  }
  return undefined
}

// ── Candidate builder ───────────────────────────────────────────────────────

function buildCsrf(
  cookieToHeader: CookieToHeaderResult | undefined,
  metaTag: MetaTagResult | undefined,
): CsrfPrimitive | undefined {
  if (cookieToHeader) {
    return { type: 'cookie_to_header', cookie: cookieToHeader.cookie, header: cookieToHeader.header }
  }
  if (metaTag) {
    return { type: 'meta_tag', name: metaTag.name, header: metaTag.header }
  }
  return undefined
}

/** Return all detected CSRF primitives, ordered by preference (cookie_to_header first). */
function buildCsrfOptions(
  cookieToHeader: CookieToHeaderResult | undefined,
  metaTag: MetaTagResult | undefined,
): CsrfPrimitive[] {
  const options: CsrfPrimitive[] = []
  if (cookieToHeader) options.push({ type: 'cookie_to_header', cookie: cookieToHeader.cookie, header: cookieToHeader.header })
  if (metaTag) options.push({ type: 'meta_tag', name: metaTag.name, header: metaTag.header })
  return options
}

function buildSigning(sapisidhash: SapisidhashResult | undefined): SigningPrimitive | undefined {
  if (!sapisidhash) return undefined
  return { type: 'sapisidhash', origin: sapisidhash.origin, inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' } }
}

function makeIdGenerator(): () => string {
  let counter = 0
  return () => `auth-${++counter}`
}

export interface AuthCandidatesResult {
  readonly candidates: AuthCandidate[]
  readonly csrfOptions: CsrfPrimitive[]
}

/**
 * Build ranked auth candidates with evidence from capture data.
 *
 * Returns ALL detected auth configurations as ranked candidates.
 * Priority: localStorage_jwt > exchange_chain > cookie_session.
 * Always returns at least one candidate (confidence 0 "none" if nothing detected).
 */
export function buildAuthCandidates(data: CaptureData): AuthCandidatesResult {
  const nextId = makeIdGenerator()
  const candidates: AuthCandidate[] = []

  // Detect all signals
  const cookieSession = detectCookieSessionWithCoverage(data)
  const localStorageJwt = detectLocalStorageJwtWithEvidence(data)
  const exchangeChain = detectExchangeChainWithEvidence(data)
  const cookieToHeader = detectCookieToHeaderEvidence(data)
  const metaTag = detectMetaTagEvidence(data)
  const sapisidhash = detectSapisidhashEvidence(data)

  const csrf = buildCsrf(cookieToHeader, metaTag)
  const csrfOptions = buildCsrfOptions(cookieToHeader, metaTag)
  const signing = buildSigning(sapisidhash)

  // Build evidence helpers
  const csrfHeaderBindings = cookieToHeader
    ? [{ cookie: cookieToHeader.cookie, header: cookieToHeader.header }]
    : undefined

  // ── localStorage_jwt candidate (rank 1, confidence 0.95) ──
  if (localStorageJwt) {
    const evidence: AuthEvidence = {
      matchedEntries: 0,
      totalEntries: data.harEntries.length,
      storageKeys: [localStorageJwt.key],
      headerBindings: csrfHeaderBindings,
      notes: [`localStorage key "${localStorageJwt.key}" path "${localStorageJwt.path}" matches Authorization header`],
    }
    const auth: AuthPrimitive = {
      type: 'localStorage_jwt',
      key: localStorageJwt.key,
      path: localStorageJwt.path,
      inject: localStorageJwt.inject,
    }
    candidates.push({
      id: nextId(),
      rank: 1,
      transport: 'node',
      auth,
      csrf,
      signing,
      confidence: 0.95,
      evidence,
    })
  }

  // ── exchange_chain candidate (rank 2, confidence 0.9) ──
  if (exchangeChain) {
    const evidence: AuthEvidence = {
      matchedEntries: 0,
      totalEntries: data.harEntries.length,
      tokenEndpoints: exchangeChain.tokenEndpoints,
      headerBindings: csrfHeaderBindings,
      notes: [`Token exchange via ${exchangeChain.tokenEndpoints.join(', ')}`],
    }
    const auth: AuthPrimitive = {
      type: 'exchange_chain',
      steps: exchangeChain.steps.map(s => ({ call: s.call, extract: s.extract })),
      inject: exchangeChain.inject,
    }
    candidates.push({
      id: nextId(),
      rank: 2,
      transport: 'node',
      auth,
      csrf,
      signing,
      confidence: 0.9,
      evidence,
    })
  }

  // ── cookie_session candidate (rank 3, confidence = coverage ratio) ──
  if (cookieSession) {
    const coverage = cookieSession.matchedEntries / cookieSession.totalEntries
    const evidence: AuthEvidence = {
      matchedEntries: cookieSession.matchedEntries,
      totalEntries: cookieSession.totalEntries,
      matchedCookies: cookieSession.matchedCookies,
      headerBindings: csrfHeaderBindings,
      notes: [
        `Cookie coverage: ${cookieSession.matchedEntries}/${cookieSession.totalEntries} entries (${(coverage * 100).toFixed(0)}%)`,
        `Matched cookies: ${cookieSession.matchedCookies.join(', ')}`,
      ],
    }
    candidates.push({
      id: nextId(),
      rank: 3,
      transport: 'node',
      auth: { type: 'cookie_session' },
      csrf,
      signing,
      confidence: coverage,
      evidence,
    })
  }

  // ── No auth detected → return 'none' candidate ──
  if (candidates.length === 0) {
    const checkedSignals: string[] = []
    if (data.stateSnapshots.length === 0) checkedSignals.push('No state snapshots available')
    if (data.harEntries.length === 0) checkedSignals.push('No HAR entries available')
    if (data.stateSnapshots.length > 0 && data.harEntries.length > 0) {
      checkedSignals.push('No localStorage JWT match found')
      checkedSignals.push('No exchange chain endpoints found')
      checkedSignals.push('No cookie session overlap found')
    }

    const evidence: AuthEvidence = {
      matchedEntries: 0,
      totalEntries: data.harEntries.length,
      rejectedSignals: checkedSignals,
      notes: ['No auth mechanism detected'],
    }
    candidates.push({
      id: nextId(),
      rank: 99,
      transport: 'node',
      auth: undefined,
      csrf: undefined,
      signing,
      confidence: 0,
      evidence,
    })
  }

  return { candidates, csrfOptions }
}
