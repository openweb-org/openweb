import type { Page } from 'playwright'

import { findNavElements, findSearchInputs, safeClick, safeType, waitForNetworkIdle } from './navigator.js'

export interface ExplorationResult {
  /** Number of nav links clicked */
  readonly linksClicked: number
  /** Number of search queries submitted */
  readonly searchesPerformed: number
  /** New URLs discovered during exploration */
  readonly discoveredUrls: string[]
}

/**
 * Explore a page by clicking navigation elements and submitting searches.
 * This generates additional network traffic that gets captured by the active
 * capture session running on the same page.
 */
export async function explorePage(
  page: Page,
  onLog?: (message: string) => void,
): Promise<ExplorationResult> {
  const log = onLog ?? (() => {})
  const discoveredUrls: string[] = []
  let linksClicked = 0
  let searchesPerformed = 0

  const startUrl = page.url()

  // Phase 1: Click navigation links
  const navElements = await findNavElements(page)
  log(`found ${String(navElements.length)} nav elements`)

  for (const nav of navElements) {
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

  return { linksClicked, searchesPerformed, discoveredUrls }
}
