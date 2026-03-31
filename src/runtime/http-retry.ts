import { OpenWebError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import type { ExecuteResult } from './http-executor.js'

// ── Per-origin rate spacing ──────────────────────────

const ORIGIN_MIN_INTERVAL_MS = 200
const originLastRequest = new Map<string, number>()

/** Enforce minimum 200ms interval between requests to the same origin. */
export async function enforceOriginSpacing(site: string): Promise<void> {
  const last = originLastRequest.get(site)
  const now = Date.now()
  if (last) {
    const elapsed = now - last
    if (elapsed < ORIGIN_MIN_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, ORIGIN_MIN_INTERVAL_MS - elapsed))
    }
  }
  originLastRequest.set(site, Date.now())
}

// ── Retry wrapper ────────────────────────────────────

const MAX_RETRIES = 2
const BASE_BACKOFF_MS = 1000

/** Non-retriable failure classes — never retry these. */
const NON_RETRIABLE: ReadonlySet<string> = new Set([
  'needs_login', 'needs_browser', 'needs_page',
  'permission_denied', 'permission_required', 'fatal',
])

/**
 * Parse Retry-After header value (seconds or HTTP-date).
 * Returns delay in ms, or undefined if unparseable.
 */
export function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

/**
 * Wrap an HTTP operation with retry + exponential backoff.
 * - 429/5xx (failureClass=retriable): retry up to 2 times
 * - Retry-After header honored when present
 * - Non-retriable errors (401/403/fatal) propagate immediately
 * - Per-origin 200ms minimum interval enforced before each attempt
 */
export async function withHttpRetry(
  fn: () => Promise<ExecuteResult>,
  site: string,
): Promise<ExecuteResult> {
  for (let attempt = 0; ; attempt++) {
    await enforceOriginSpacing(site)
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof OpenWebError)) throw err
      if (NON_RETRIABLE.has(err.payload.failureClass)) throw err
      if (attempt >= MAX_RETRIES) throw err

      const retryAfterMs = parseRetryAfter(err.payload.retryAfter)
      const backoff = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt
      logger.debug(`Retry ${attempt + 1}/${MAX_RETRIES} for ${site} after ${backoff}ms (${err.payload.message})`)
      await new Promise(resolve => setTimeout(resolve, backoff))
    }
  }
}
