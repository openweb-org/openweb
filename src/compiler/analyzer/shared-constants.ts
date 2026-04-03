/** Shared constants and helpers for auth/CSRF detection in the analyzer pipeline. */

export const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Headers to skip during CSRF detection — standard HTTP headers that can never be CSRF targets */
export const SKIP_HEADERS = new Set([
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

/** Strip surrounding double quotes from cookie values (e.g. LinkedIn JSESSIONID) */
export function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '')
}

/** Check if a header is a standard non-CSRF header (sec-* prefix — never CSRF) */
export function isStandardSecHeader(headerName: string): boolean {
  return headerName.toLowerCase().startsWith('sec-')
}
