import type { CaptureData } from './classify.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Headers to skip during CSRF detection — standard HTTP headers that can never be CSRF targets */
const SKIP_HEADERS = new Set([
  'cookie',
  'content-type',
  'content-length',
  'accept',
  'host',
  'user-agent',
  'accept-encoding',
  'accept-language',
  'connection',
  'origin',
  'referer',
  'dpr',
  'screen-dpr',
  'viewport-width',
])

/** Well-known CSRF header names — prioritized over random header matches */
const CSRF_HEADER_NAMES = new Set(['csrf-token', 'x-csrf-token', 'x-csrftoken', '_csrf'])

/** Strip surrounding double quotes from cookie values (e.g. LinkedIn JSESSIONID) */
function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '')
}

/** Check if a header is a standard non-CSRF header (sec-* prefix — never CSRF) */
function isStandardSecHeader(headerName: string): boolean {
  return headerName.toLowerCase().startsWith('sec-')
}

interface CookieHeaderMatch {
  cookie: string
  header: string
  preferred: boolean
}

/**
 * Scan mutation entries for cookie→header matches, returning all found.
 * Each match is tagged `preferred` if the header name is a well-known CSRF name.
 */
function findCookieHeaderMatches(
  mutations: CaptureData['harEntries'],
  cookieValues: Map<string, string>,
): CookieHeaderMatch[] {
  const matches: CookieHeaderMatch[] = []
  for (const entry of mutations) {
    for (const header of entry.request.headers) {
      const name = header.name.toLowerCase()
      if (SKIP_HEADERS.has(name)) continue
      if (isStandardSecHeader(header.name)) continue

      for (const [cookieName, rawCookieValue] of cookieValues) {
        const cookieValue = stripQuotes(rawCookieValue)
        if (cookieValue.length > 0 && header.value === cookieValue) {
          matches.push({
            cookie: cookieName,
            header: header.name,
            preferred: CSRF_HEADER_NAMES.has(name),
          })
        }
      }
    }
  }
  return matches
}

/**
 * Detect cookie_to_header CSRF: for mutation requests,
 * find a header value that matches a cookie value from state_snapshots.
 */
export function detectCookieToHeader(data: CaptureData): { cookie: string; header: string } | undefined {
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

  const matches = findCookieHeaderMatches(mutations, cookieValues)
  if (matches.length === 0) return undefined

  // Prefer standard CSRF header names, fall back to first match
  const preferred = matches.find((m) => m.preferred)
  const best = preferred ?? matches[0]
  if (!best) return undefined
  return { cookie: best.cookie, header: best.header }
}

/**
 * Detect meta_tag CSRF: a <meta name="..." content="..."> tag whose content
 * value appears in a custom header on mutation requests.
 */
export function detectMetaTag(data: CaptureData): { name: string; header: string } | undefined {
  if (!data.domHtml) return undefined

  // Find <meta name="..." content="..."> tags
  const metaRegex = /<meta\s+name="([^"]+)"\s+content="([^"]+)"/gi
  const metaTags = new Map<string, string>()
  for (let match = metaRegex.exec(data.domHtml); match !== null; match = metaRegex.exec(data.domHtml)) {
    metaTags.set(match[1] ?? '', match[2] ?? '')
  }

  if (metaTags.size === 0) return undefined

  // Check if any meta tag value appears in mutation request headers
  const mutations = data.harEntries.filter((e) => MUTATION_METHODS.has(e.request.method))
  for (const entry of mutations) {
    for (const header of entry.request.headers) {
      const name = header.name.toLowerCase()
      if (SKIP_HEADERS.has(name)) continue
      if (isStandardSecHeader(header.name)) continue

      for (const [metaName, metaValue] of metaTags) {
        if (header.value === metaValue && metaValue.length > 0) {
          return { name: metaName, header: header.name }
        }
      }
    }
  }

  return undefined
}
