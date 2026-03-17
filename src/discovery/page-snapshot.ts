import type { Page } from 'playwright'

export interface NavLink {
  readonly text: string
  readonly href: string
  readonly isInternal: boolean
}

export interface ButtonInfo {
  readonly text: string
  readonly type: 'submit' | 'button' | 'other'
  readonly formAction?: string
}

export interface FormInfo {
  readonly action: string
  readonly method: string
  readonly inputNames: string[]
}

export interface SearchInput {
  readonly placeholder: string
  readonly selector: string
}

export interface PageSnapshot {
  readonly navLinks: NavLink[]
  readonly headings: string[]
  readonly buttons: ButtonInfo[]
  readonly forms: FormInfo[]
  readonly searchInputs: SearchInput[]
}

/**
 * Extract structured page signals for intent-driven discovery.
 * Runs a single page.evaluate to minimize round-trips.
 */
export async function takePageSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const origin = window.location.origin

    // --- Nav links ---
    const navLinks: Array<{ text: string; href: string; isInternal: boolean }> = []
    const seenHrefs = new Set<string>()
    const navContainers = document.querySelectorAll(
      'nav, [role="navigation"], header, aside, [class*="sidebar"], [class*="nav"], [class*="menu"]',
    )
    for (const container of navContainers) {
      for (const link of container.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href')
        const text = (link.textContent ?? '').trim()
        if (!text || !href || href === '#' || href.startsWith('javascript:')) continue
        if (seenHrefs.has(href)) continue
        seenHrefs.add(href)
        let isInternal = false
        try {
          isInternal = new URL(href, origin).origin === origin
        } catch {
          isInternal = href.startsWith('/')
        }
        navLinks.push({ text: text.slice(0, 100), href, isInternal })
      }
    }

    // --- Headings ---
    const headings: string[] = []
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      const text = (h.textContent ?? '').trim()
      if (text) headings.push(text.slice(0, 200))
    }

    // --- Buttons ---
    const buttons: Array<{ text: string; type: 'submit' | 'button' | 'other'; formAction?: string }> = []
    for (const btn of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
      const text = ((btn as HTMLElement).textContent ?? (btn as HTMLInputElement).value ?? '').trim()
      if (!text) continue
      const rawType = btn.getAttribute('type')
      const type = rawType === 'submit' ? 'submit' : rawType === 'button' ? 'button' : 'other'
      const formAction = btn.getAttribute('formaction') ?? undefined
      buttons.push({ text: text.slice(0, 100), type, formAction })
    }

    // --- Forms ---
    const forms: Array<{ action: string; method: string; inputNames: string[] }> = []
    for (const form of document.querySelectorAll('form')) {
      const action = form.getAttribute('action') ?? ''
      const method = (form.getAttribute('method') ?? 'get').toUpperCase()
      const inputNames: string[] = []
      for (const input of form.querySelectorAll('input[name], select[name], textarea[name]')) {
        const name = input.getAttribute('name')
        if (name) inputNames.push(name)
      }
      forms.push({ action, method, inputNames })
    }

    // --- Search inputs ---
    const searchInputs: Array<{ placeholder: string; selector: string }> = []
    const searchSelectors = [
      'input[type="search"]',
      'input[name*="search"]',
      'input[name*="query"]',
      'input[name="q"]',
      'input[placeholder*="search" i]',
      'input[aria-label*="search" i]',
    ]
    const seen = new Set<Element>()
    for (const sel of searchSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue
        seen.add(el)
        const placeholder = (el as HTMLInputElement).placeholder ?? ''
        const id = el.id ? `#${el.id}` : ''
        const name = el.getAttribute('name')
        const selector = id || (name ? `input[name="${name}"]` : sel)
        searchInputs.push({ placeholder, selector })
      }
    }

    return {
      navLinks: navLinks.slice(0, 50),
      headings: headings.slice(0, 20),
      buttons: buttons.slice(0, 30),
      forms: forms.slice(0, 10),
      searchInputs: searchInputs.slice(0, 5),
    }
  })
}
