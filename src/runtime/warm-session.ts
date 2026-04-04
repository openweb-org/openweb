import type { Page } from 'patchright'

import { logger } from '../lib/logger.js'

// ── Types ────────────────────────────────────────

export interface WarmSessionOptions {
  /** Max time to wait for sensor scripts (default 5000ms) */
  timeoutMs?: number
  /** Cookie name to wait for stabilization (e.g. '_abck' for Akamai) */
  waitForCookie?: string
}

// ── Warm-state cache ─────────────────────────────

/** Pages that have already been warmed — second call is a no-op. */
let warmedPages = new WeakSet<Page>()

// ── Constants ────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5_000
const COOKIE_POLL_INTERVAL_MS = 500
const FIXED_DELAY_MS = 3_000

// ── Implementation ───────────────────────────────

/**
 * Warm a browser page for bot-protected sites.
 *
 * Navigates to the URL (if not already on the same origin), then waits for
 * sensor scripts (Akamai sensor.js, DataDome JS, etc.) to generate valid
 * session cookies. After warmSession() returns, the page is ready for
 * `page.evaluate(fetch(...))`.
 *
 * Warm state is cached per Page instance — calling twice on the same page
 * is a no-op.
 */
export async function warmSession(
  page: Page,
  url: string,
  opts?: WarmSessionOptions,
): Promise<void> {
  if (warmedPages.has(page)) {
    logger.debug('warm-session: already warmed, skipping')
    return
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cookie = opts?.waitForCookie

  // Navigate only if not already on the target origin
  const targetOrigin = new URL(url).origin
  let currentOrigin: string | undefined
  try {
    currentOrigin = new URL(page.url()).origin
  } catch {
    // about:blank or invalid URL — need to navigate
  }

  if (currentOrigin !== targetOrigin) {
    logger.debug(`warm-session: navigating to ${url}`)
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs + 10_000 })
  } else {
    logger.debug(`warm-session: already on ${targetOrigin}, skipping navigation`)
  }

  // Wait for sensor scripts to complete
  if (cookie) {
    await pollCookieStabilization(page, url, cookie, timeoutMs)
  } else {
    const delay = Math.min(FIXED_DELAY_MS, timeoutMs)
    logger.debug(`warm-session: fixed delay ${delay}ms (no cookie specified)`)
    await new Promise((r) => setTimeout(r, delay))
  }

  warmedPages.add(page)
  logger.debug('warm-session: page warmed')
}

// ── Cookie polling ───────────────────────────────

async function pollCookieStabilization(
  page: Page,
  url: string,
  cookieName: string,
  timeoutMs: number,
): Promise<void> {
  logger.debug(`warm-session: polling cookie '${cookieName}' for stabilization`)
  const start = Date.now()
  let previousValue: string | undefined

  while (Date.now() - start < timeoutMs) {
    const cookies = await page.context().cookies(url)
    const target = cookies.find((c) => c.name === cookieName)
    const currentValue = target?.value

    if (currentValue !== undefined && currentValue === previousValue) {
      logger.debug(`warm-session: cookie '${cookieName}' stabilized`)
      return
    }

    previousValue = currentValue
    await new Promise((r) => setTimeout(r, COOKIE_POLL_INTERVAL_MS))
  }

  logger.debug(`warm-session: cookie '${cookieName}' did not stabilize within ${timeoutMs}ms, proceeding anyway`)
}

// ── Test helper ──────────────────────────────────

/** @internal Reset warm-state cache — only for tests. */
export function _resetWarmCache(): void {
  warmedPages = new WeakSet<Page>()
}
