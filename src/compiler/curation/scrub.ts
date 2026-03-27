/**
 * PII scrubbing for example values.
 *
 * Executes within applyCuration() so that:
 * - Analyze can still inspect raw captured values
 * - Generate receives already-scrubbed data
 */

const REDACTED = '<REDACTED>'
const REDACTED_TOKEN = '<REDACTED_TOKEN>'
const REDACTED_COOKIE = '<REDACTED_COOKIE>'
const SAFE_EMAIL = 'user@example.com'
const SAFE_PHONE = '+1-555-0100'

/** Keys whose values are always redacted regardless of content. */
const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
])

const COOKIE_KEYS = new Set(['cookie', 'set-cookie'])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/
const BASE64_RE = /^[A-Za-z0-9+/=_-]+$/

function looksLikeToken(value: string): boolean {
  if (value.length <= 30) return false
  return value.startsWith('ey') || BASE64_RE.test(value)
}

function scrubValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value

  const lowerKey = key.toLowerCase()

  if (SENSITIVE_KEYS.has(lowerKey)) return REDACTED
  if (COOKIE_KEYS.has(lowerKey)) return REDACTED_COOKIE
  if (looksLikeToken(value)) return REDACTED_TOKEN
  if (EMAIL_RE.test(value)) return SAFE_EMAIL
  if (PHONE_RE.test(value)) return SAFE_PHONE

  return value
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = scrubUnknown(key, value)
  }
  return result
}

function scrubUnknown(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubValue(key, value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item, i) => scrubUnknown(String(i), item))
  if (typeof value === 'object') return scrubObject(value as Record<string, unknown>)
  return value
}

/** Scrub PII from example input parameters. */
export function scrubExamples(input: Record<string, unknown>): Record<string, unknown> {
  return scrubObject(input)
}

/** Scrub PII from a request body (arbitrary JSON). */
export function scrubRequestBody(body: unknown): unknown {
  return scrubUnknown('', body)
}
