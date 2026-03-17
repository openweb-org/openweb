import type { Page } from 'playwright'

/**
 * Safe navigation: goto URL, wait for DOM content loaded.
 * Returns true if navigation succeeded.
 */
export async function navigateTo(page: Page, url: string, timeoutMs = 30_000): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/**
 * Safe click: click element, catch errors (stale, detached, invisible).
 * Returns true if click succeeded.
 */
export async function safeClick(page: Page, selector: string, timeoutMs = 5000): Promise<boolean> {
  try {
    await page.click(selector, { timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/**
 * Safe type: fill input field with text.
 * Returns true if successful.
 */
export async function safeType(page: Page, selector: string, text: string, timeoutMs = 5000): Promise<boolean> {
  try {
    await page.fill(selector, text, { timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/**
 * Wait for network to become idle.
 * Combines Playwright's networkidle with an extra quiet period.
 */
export async function waitForNetworkIdle(page: Page, quietMs = 1500, maxWaitMs = 10000): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: maxWaitMs })
  } catch {
    // timeout is ok
  }
  await new Promise((resolve) => setTimeout(resolve, quietMs))
}

export interface NavElement {
  readonly selector: string
  readonly text: string
  readonly href: string | null
}

/**
 * Find navigation elements on the page (links in nav, sidebar, menu areas).
 * Returns selectors + text for each.
 */
export async function findNavElements(page: Page): Promise<NavElement[]> {
  return page.evaluate(() => {
    const elements: Array<{ selector: string; text: string; href: string | null }> = []
    const seen = new Set<string>()

    // Find links within nav-like containers
    const navContainers = document.querySelectorAll(
      'nav, [role="navigation"], aside, [class*="sidebar"], [class*="nav"], [class*="menu"]',
    )

    for (const container of navContainers) {
      const links = container.querySelectorAll('a[href]')
      for (const link of links) {
        const href = link.getAttribute('href')
        const text = (link.textContent ?? '').trim()
        if (!text || !href || href === '#' || href === 'javascript:void(0)') continue
        if (seen.has(href)) continue
        seen.add(href)

        // Build a reasonable selector
        const id = link.id ? `#${link.id}` : ''
        const selector = id || `a[href="${href}"]`
        elements.push({ selector, text: text.slice(0, 80), href })
      }
    }

    return elements.slice(0, 30) // Cap at 30 nav links
  })
}

/**
 * Find search input elements on the page.
 */
export async function findSearchInputs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors: string[] = []

    const inputs = document.querySelectorAll(
      'input[type="search"], input[name*="search"], input[name*="query"], input[name="q"], input[placeholder*="search" i], input[aria-label*="search" i]',
    )

    for (const input of inputs) {
      const id = input.id ? `#${input.id}` : ''
      const name = input.getAttribute('name')
      const selector = id || (name ? `input[name="${name}"]` : 'input[type="search"]')
      selectors.push(selector)
    }

    return selectors.slice(0, 5) // Cap at 5
  })
}
