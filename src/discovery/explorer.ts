import type { Page } from 'playwright'

import type { IntentGap } from './intent.js'
import { findNavElements, findSearchInputs, safeClick, safeType, waitForNetworkIdle } from './navigator.js'
import type { PageSnapshot } from './page-snapshot.js'

export interface ExplorationResult {
  /** Number of nav links clicked */
  readonly linksClicked: number
  /** Number of search queries submitted */
  readonly searchesPerformed: number
  /** New URLs discovered during exploration */
  readonly discoveredUrls: string[]
  /** Links skipped due to destructive denylist */
  readonly skippedDestructive: number
}

/** Link text/href patterns that indicate destructive or account-altering actions */
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\b(sign.?out|log.?out|logout)\b/i,
  /\b(delete|remove|destroy)\b/i,
  /\b(unsubscribe|deactivate|close.?account)\b/i,
  /\b(billing|payment|upgrade|subscription)\b/i,
  /\bsettings\/account\b/i,
  /\b(cancel|revoke)\b/i,
]

function isDestructiveLink(text: string, href: string | null): boolean {
  const combined = `${text} ${href ?? ''}`
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(combined))
}

/**
 * Explore a page by clicking navigation elements and submitting searches.
 * This generates additional network traffic that gets captured by the active
 * capture session running on the same page.
 *
 * Safety: links matching destructive patterns (logout, delete, billing, etc.)
 * are skipped. Exploration is opt-in (--explore flag).
 */
export async function explorePage(
  page: Page,
  onLog?: (message: string) => void,
): Promise<ExplorationResult> {
  const log = onLog ?? (() => {})
  const discoveredUrls: string[] = []
  let linksClicked = 0
  let searchesPerformed = 0
  let skippedDestructive = 0

  const startUrl = page.url()

  // Phase 1: Click navigation links
  const navElements = await findNavElements(page)
  log(`found ${String(navElements.length)} nav elements`)

  for (const nav of navElements) {
    // Skip destructive links
    if (isDestructiveLink(nav.text, nav.href)) {
      skippedDestructive++
      continue
    }

    // Skip external links
    if (nav.href) {
      try {
        const targetOrigin = new URL(nav.href, startUrl).origin
        const currentOrigin = new URL(startUrl).origin
        if (targetOrigin !== currentOrigin) continue
      } catch {
        continue
      }
    }

    const clicked = await safeClick(page, nav.selector)
    if (!clicked) continue

    linksClicked++
    await waitForNetworkIdle(page)

    const currentUrl = page.url()
    if (currentUrl !== startUrl && !discoveredUrls.includes(currentUrl)) {
      discoveredUrls.push(currentUrl)
      log(`  explored: ${nav.text} → ${currentUrl}`)
    }

    // Navigate back to start URL to continue exploring
    if (currentUrl !== startUrl) {
      try {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        await waitForNetworkIdle(page)
      } catch {
        log('  failed to navigate back — stopping link exploration')
        break
      }
    }
  }

  // Phase 2: Try search inputs
  const searchInputs = await findSearchInputs(page)
  if (searchInputs.length > 0) {
    const testQuery = 'test'
    for (const selector of searchInputs) {
      const typed = await safeType(page, selector, testQuery)
      if (!typed) continue

      // Submit search by pressing Enter
      try {
        await page.keyboard.press('Enter')
        searchesPerformed++
        await waitForNetworkIdle(page)
        const currentUrl = page.url()
        if (currentUrl !== startUrl && !discoveredUrls.includes(currentUrl)) {
          discoveredUrls.push(currentUrl)
          log(`  search: "${testQuery}" → ${currentUrl}`)
        }
      } catch {
        // search submission failed — ok
      }

      // Navigate back
      if (page.url() !== startUrl) {
        try {
          await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
          await waitForNetworkIdle(page)
        } catch {
          break
        }
      }
    }
  }

  if (skippedDestructive > 0) {
    log(`skipped ${String(skippedDestructive)} destructive link(s)`)
  }

  return { linksClicked, searchesPerformed, discoveredUrls, skippedDestructive }
}

// --- Intent-driven exploration ---

/** Max UI interactions per intent gap */
const MAX_PER_INTENT = 3
/** Max total interactions across all gaps */
const MAX_TOTAL_INTERACTIONS = 15

/** Read intents that can be explored by clicking nav links */
const CLICKABLE_INTENTS = new Set(['profile', 'feed', 'social', 'activity', 'meta'])

/** Map intent → nav link text patterns to find matching elements */
const INTENT_NAV_PATTERNS: Readonly<Record<string, RegExp>> = {
  profile: /\b(profile|settings|account|my\s?\w+)\b/i,
  feed: /\b(home|feed|timeline|explore|discover|browse)\b/i,
  social: /\b(friends|followers|contacts|messages|chat|inbox|mail)\b/i,
  activity: /\b(notifications|activity|history|alerts)\b/i,
  meta: /\b(categories|tags|about|help|faq|docs|api)\b/i,
}

/**
 * Intent-driven exploration: only click/interact with elements
 * that correspond to missing intent gaps. Write intents are recorded
 * but not executed.
 */
export async function exploreForIntents(
  page: Page,
  gaps: IntentGap[],
  snapshot: PageSnapshot,
  onLog?: (message: string) => void,
): Promise<ExplorationResult> {
  const log = onLog ?? (() => {})
  const discoveredUrls: string[] = []
  let linksClicked = 0
  let searchesPerformed = 0
  let skippedDestructive = 0
  let totalInteractions = 0

  const startUrl = page.url()

  for (const gap of gaps) {
    if (totalInteractions >= MAX_TOTAL_INTERACTIONS) {
      log(`  reached max interactions (${String(MAX_TOTAL_INTERACTIONS)}), stopping`)
      break
    }

    let attemptsForGap = 0

    // Search intent → use search inputs
    if (gap.intent === 'search') {
      for (const input of snapshot.searchInputs) {
        if (attemptsForGap >= MAX_PER_INTENT || totalInteractions >= MAX_TOTAL_INTERACTIONS) break
        const typed = await safeType(page, input.selector, 'test')
        if (!typed) continue
        try {
          await page.keyboard.press('Enter')
          searchesPerformed++
          totalInteractions++
          attemptsForGap++
          await waitForNetworkIdle(page)
          const currentUrl = page.url()
          if (currentUrl !== startUrl && !discoveredUrls.includes(currentUrl)) {
            discoveredUrls.push(currentUrl)
            log(`  intent(search): "${input.placeholder || input.selector}" → ${currentUrl}`)
          }
        } catch {
          // ok
        }
        if (page.url() !== startUrl) {
          try {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
            await waitForNetworkIdle(page)
          } catch { break }
        }
      }
      continue
    }

    // Clickable read intents → find matching nav links
    if (CLICKABLE_INTENTS.has(gap.intent)) {
      const pattern = INTENT_NAV_PATTERNS[gap.intent]
      if (!pattern) continue

      const matchingLinks = snapshot.navLinks.filter(
        (link) => link.isInternal && pattern.test(link.text),
      )

      for (const link of matchingLinks) {
        if (attemptsForGap >= MAX_PER_INTENT || totalInteractions >= MAX_TOTAL_INTERACTIONS) break
        if (isDestructiveLink(link.text, link.href)) {
          skippedDestructive++
          continue
        }

        const escapedHref = link.href.replace(/["\\]/g, '\\$&')
        const selector = `a[href="${escapedHref}"]`
        const clicked = await safeClick(page, selector)
        if (!clicked) continue

        linksClicked++
        totalInteractions++
        attemptsForGap++
        await waitForNetworkIdle(page)

        const currentUrl = page.url()
        if (currentUrl !== startUrl && !discoveredUrls.includes(currentUrl)) {
          discoveredUrls.push(currentUrl)
          log(`  intent(${gap.intent}): "${link.text}" → ${currentUrl}`)
        }

        if (currentUrl !== startUrl) {
          try {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
            await waitForNetworkIdle(page)
          } catch {
            log('  failed to navigate back — stopping')
            break
          }
        }
      }
      continue
    }

    // Write intents → record entry points only, do not execute
    log(`  intent(${gap.intent}): write intent recorded — not executing`)
  }

  return { linksClicked, searchesPerformed, discoveredUrls, skippedDestructive }
}
