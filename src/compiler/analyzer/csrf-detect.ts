import type { CaptureData } from './classify.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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
 * Detect meta_tag CSRF: a <meta name="..." content="..."> tag whose content
 * value appears in a custom header on mutation requests.
 */
export function detectMetaTag(data: CaptureData): { name: string; header: string } | undefined {
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
