import type { BrowserContext, Page } from 'patchright'

import { TIMEOUT } from '../lib/config.js'
import { logger } from '../lib/logger.js'
import { listCandidatePages } from './page-candidates.js'
import {
  autoNavigate,
  createNeedsPageError,
  findPageForOrigin,
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
  /**
   * When true, after the strict entry_url match misses, try a same-origin
   * fuzzy match (findPageForOrigin) before navigating. Lets extraction-only
   * ops without an explicit page_url reuse whatever same-origin tab is open
   * instead of forcing a literal-path navigation that may hit a SPA shell or
   * CAPTCHA target. Callers set this when entry_url was derived from the
   * operation path template (no user-provided page_url).
   */
  readonly allow_origin_fallback?: boolean
  /**
   * When true, a reused page whose URL is not exactly entry_url is re-navigated
   * via page.goto(entry_url) before being returned. Path-prefix reuse is unsafe
   * for state-bound extractions (page_global_data, script_json) where the
   * window/script-tag state is tied to the specific URL — a homepage tab that
   * prefix-matches every site path would otherwise leak stale state into
   * subsequent ops. Reuse rule remains path-prefix; this flag only changes
   * post-match behavior. Set by extraction-executor for state-bound primitives.
   */
  readonly refresh_on_reuse?: boolean
}

export interface AcquiredPage {
  readonly page: Page
  /** true when acquirePage created the page — caller must close it. */
  readonly owned: boolean
}

/** Substitute {var} tokens in a PagePlan entry_url using caller params.
 *  Undefined input passes through. Unresolvable tokens are left intact
 *  (the URL may be passed to findPageMatchingEntry where a literal { is
 *  harmless for equality/prefix checks — real navigation failures will
 *  surface as needs_page rather than corrupted URLs). */
export function interpolateEntryUrl(
  template: string | undefined,
  params: Record<string, unknown> | undefined,
): string | undefined {
  if (template === undefined) return undefined
  if (!params) return template
  return template.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const v = params[name]
    if (v === undefined || v === null) return match
    return String(v)
  })
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

/** Same-origin URL equality ignoring hash, with query-superset semantics
 *  matching matchesEntryUrl. Returns true when the page is "already on"
 *  entry_url such that no refresh is needed. */
function isExactEntryUrl(pageUrl: string, entryUrl: string): boolean {
  try {
    const p = new URL(pageUrl)
    const e = new URL(entryUrl)
    if (p.origin !== e.origin) return false
    if (decodeURIComponent(p.pathname) !== decodeURIComponent(e.pathname)) return false
    for (const [key, value] of e.searchParams) {
      const pageValues = p.searchParams.getAll(key)
      if (!pageValues.includes(value)) return false
    }
    return true
  } catch {
    return false
  }
}

async function refreshIfNeeded(page: Page, plan: PagePlan): Promise<void> {
  if (!plan.refresh_on_reuse) return
  if (isExactEntryUrl(page.url(), plan.entry_url)) return
  const waitUntil = plan.wait_until ?? 'load'
  const timeout = plan.nav_timeout_ms ?? TIMEOUT.navigation
  logger.debug(`acquirePage: refresh_on_reuse navigating ${page.url()} → ${plan.entry_url}`)
  await page.goto(plan.entry_url, { waitUntil, timeout })
}

async function applyPostAcquire(page: Page, plan: PagePlan): Promise<void> {
  await refreshIfNeeded(page, plan)
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
 * No origin-only fuzzy fallback by default: callers that want origin-level
 * reuse should set entry_url to the server origin, OR pass
 * allow_origin_fallback: true (e.g. extraction ops without explicit page_url)
 * to opt into a same-origin tab match before navigating.
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

  // 1b. Fuzzy origin fallback: when caller has no explicit page_url, reuse
  // any same-origin tab rather than forcing nav to the operation's literal
  // path (which may be a SPA shell, search-results page, or CAPTCHA target).
  if (plan.allow_origin_fallback) {
    const originMatch = await findPageForOrigin(context, plan.entry_url)
    if (originMatch) {
      await applyPostAcquire(originMatch, plan)
      return { page: originMatch, owned: false }
    }
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
