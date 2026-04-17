import type { Page } from 'patchright'

import { logger } from '../lib/logger.js'
import { detectPageBotBlock } from './bot-detect.js'

// ── Types ────────────────────────────────────────

export interface WarmSessionOptions {
  /** Max time to wait for sensor scripts (default 5000ms) */
  timeoutMs?: number
  /** Cookie name to wait for stabilization (e.g. '_abck' for Akamai) */
  waitForCookie?: string
  /** Max PerimeterX retries. When the landing page is a PX block after the
   *  warm delay, clear cookies and re-navigate up to this many times. 0
   *  disables. Default 3. */
  botRetries?: number
}

// ── Warm-state cache ─────────────────────────────

/** Pages that have already been warmed — second call is a no-op. */
let warmedPages = new WeakSet<Page>()

// ── Constants ────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5_000
const COOKIE_POLL_INTERVAL_MS = 500
const FIXED_DELAY_MS = 3_000
const DEFAULT_BOT_RETRIES = 3
const BOT_RETRY_BASE_DELAY_MS = 1_000

// ── Implementation ───────────────────────────────

/**
 * Warm a browser page for bot-protected sites.
 *
 * Navigates to the URL (if not already on the same origin), then waits for
 * sensor scripts (Akamai sensor.js, DataDome JS, etc.) to generate valid
 * session cookies. After warmSession() returns, the page is ready for
 * `page.evaluate(fetch(...))`.
 *
 * If a PerimeterX block / CAPTCHA is detected after the warm delay, clears
 * cookies and re-navigates up to `botRetries` times with backoff. Mirrors
 * the per-site retry loops previously hand-coded in adapters (goodrx).
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
  const botRetries = opts?.botRetries ?? DEFAULT_BOT_RETRIES

  await navigateAndSettle(page, url, timeoutMs, cookie)

  for (let attempt = 0; attempt < botRetries; attempt++) {
    const signal = await detectPageBotBlock(page).catch(() => undefined)
    if (!signal) break
    logger.debug(`warm-session: bot block detected (${signal}); clearing cookies + retry ${attempt + 1}/${botRetries}`)
    await page.goto('about:blank').catch(() => {})
    await page.context().clearCookies().catch(() => {})
    await new Promise((r) => setTimeout(r, BOT_RETRY_BASE_DELAY_MS * (attempt + 1)))
    await navigateAndSettle(page, url, timeoutMs, cookie)
  }

  warmedPages.add(page)
  logger.debug('warm-session: page warmed')
}

async function navigateAndSettle(
  page: Page,
  url: string,
  timeoutMs: number,
  cookie: string | undefined,
): Promise<void> {
  const targetOrigin = new URL(url).origin
  let currentOrigin: string | undefined
  try {
    currentOrigin = new URL(page.url()).origin
  } catch {
    // about:blank or invalid URL — need to navigate
  }

  if (currentOrigin !== targetOrigin) {
    logger.debug(`warm-session: navigating to ${url}`)
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs + 10_000 }).catch(() => {})
  } else {
    logger.debug(`warm-session: already on ${targetOrigin}, skipping navigation`)
  }

  if (cookie) {
    await pollCookieStabilization(page, url, cookie, timeoutMs)
  } else {
    const delay = Math.min(FIXED_DELAY_MS, timeoutMs)
    logger.debug(`warm-session: fixed delay ${delay}ms (no cookie specified)`)
    await new Promise((r) => setTimeout(r, delay))
  }
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
