import type { BrowserContext, Page } from 'patchright'

import { TIMEOUT } from '../lib/config.js'
import { logger } from '../lib/logger.js'
import { listCandidatePages } from './page-candidates.js'
import {
  autoNavigate,
  createNeedsPageError,
} from './session-executor.js'
import { warmSession } from './warm-session.js'

export type PageWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'

export interface PagePlan {
  /** Fully-resolved URL the executor wants a page on (origin + path, optional query). */
  readonly entry_url: string
  /** Optional CSS selector to wait for after navigation. */
  readonly ready?: string
  /** page.goto waitUntil — defaults to 'load'. */
  readonly wait_until?: PageWaitUntil
  /** Post-navigation settle delay (ms). */
  readonly settle_ms?: number
  /** When true, run warmSession() on the acquired page. */
  readonly warm?: boolean
  /** Navigation timeout (ms) — defaults to TIMEOUT.navigation. */
  readonly nav_timeout_ms?: number
  /**
   * When true, acquirePage skips the page-reuse lookup AND skips page.goto().
   * It opens a blank page (owned=true) and returns it un-navigated so the
   * caller can install listeners before navigation. Post-acquire hooks
   * (ready/settle_ms/warm) are also skipped — the caller owns the nav lifecycle.
   *
   * Used by response_capture extraction to avoid racing the response listener
   * against a page that has already loaded.
   */
  readonly forceFresh?: boolean
}

export interface AcquiredPage {
  readonly page: Page
  /** true when acquirePage created the page — caller must close it. */
  readonly owned: boolean
}

/** True when pageUrl is same-origin with entry_url, its pathname is at/under
 *  entry's, and — when entry_url carries query params — every entry param
 *  appears verbatim on the page URL (page may carry extra params). Hash is
 *  ignored on both sides. */
export function matchesEntryUrl(pageUrl: string, entryUrl: string): boolean {
  try {
    const p = new URL(pageUrl)
    const e = new URL(entryUrl)
    if (p.origin !== e.origin) return false
    const pPath = decodeURIComponent(p.pathname)
    const ePath = decodeURIComponent(e.pathname)
    if (ePath !== '' && ePath !== '/') {
      if (pPath !== ePath) {
        const base = ePath.endsWith('/') ? ePath : `${ePath}/`
        if (!pPath.startsWith(base)) return false
      }
    }
    // Query must be a superset: every param/value in entry must appear on page.
    for (const [key, value] of e.searchParams) {
      const pageValues = p.searchParams.getAll(key)
      if (!pageValues.includes(value)) return false
    }
    return true
  } catch {
    return false
  }
}

async function findPageMatchingEntry(
  context: BrowserContext,
  entryUrl: string,
): Promise<Page | undefined> {
  const pages = await listCandidatePages(context)
  for (const page of pages) {
    try {
      if (matchesEntryUrl(page.url(), entryUrl)) return page
    } catch {
      // detached / about:blank
    }
  }
  return undefined
}

async function applyPostAcquire(page: Page, plan: PagePlan): Promise<void> {
  if (plan.ready) {
    try {
      await page.waitForSelector(plan.ready, {
        timeout: plan.nav_timeout_ms ?? TIMEOUT.navigation,
      })
    } catch (err) {
      logger.debug(`ready selector "${plan.ready}" not found: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (plan.settle_ms && plan.settle_ms > 0) {
    await page.waitForTimeout(plan.settle_ms)
  }
  if (plan.warm) {
    await warmSession(page, plan.entry_url)
  }
}

/**
 * Acquire a browser page for the given entry_url.
 *
 * Reuse rule: same-origin page whose path prefix-matches entry_url is reused.
 * Otherwise navigates to entry_url. If direct navigation fails (connection
 * error, subdomain-only API URL returning an error from goto), falls back to
 * autoNavigate(serverUrl) which applies the parent-domain retry — this
 * handles API subdomains (e.g. stock.xueqiu.com → xueqiu.com).
 *
 * No origin-only fuzzy fallback: callers that want origin-level reuse should
 * set entry_url to the server origin.
 *
 * PagePlan skipped by callers when resolvedTransport === 'node'.
 */
export async function acquirePage(
  context: BrowserContext,
  serverUrl: string,
  plan: PagePlan,
): Promise<AcquiredPage> {
  // forceFresh: hand back an un-navigated new page. Caller owns the nav lifecycle.
  if (plan.forceFresh) {
    const page = await context.newPage()
    return { page, owned: true }
  }

  // 1. Reuse an existing page that already covers entry_url.
  const entryMatch = await findPageMatchingEntry(context, plan.entry_url)
  if (entryMatch) {
    await applyPostAcquire(entryMatch, plan)
    return { page: entryMatch, owned: false }
  }

  // 2. Navigate to entry_url directly.
  const waitUntil = plan.wait_until ?? 'load'
  const timeout = plan.nav_timeout_ms ?? TIMEOUT.navigation
  let directPage: Page | undefined
  try {
    directPage = await context.newPage()
    await directPage.goto(plan.entry_url, { waitUntil, timeout })
    await applyPostAcquire(directPage, plan)
    return { page: directPage, owned: true }
  } catch (err) {
    if (directPage) await directPage.close().catch(() => {})
    logger.debug(`acquirePage: direct navigation to ${plan.entry_url} failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 3. Fall back to autoNavigate(serverUrl) — parent-domain retry for API subdomains.
  const nav = await autoNavigate(context, serverUrl)
  if (nav) {
    await applyPostAcquire(nav.page, plan)
    return { page: nav.page, owned: nav.owned }
  }

  throw createNeedsPageError(serverUrl)
}
