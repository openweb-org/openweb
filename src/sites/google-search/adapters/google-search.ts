/**
 * Google Search adapter — DOM extraction for web and image search results.
 *
 * searchWeb:    Extract organic results from /search page
 * searchImages: Extract image results from /search?udm=2 page
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

/* ---------- searchWeb ---------- */

async function searchWeb(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const items: Array<{ title: string; link: string; displayUrl: string; snippet: string }> = []
    const containers = document.querySelectorAll('div.tF2Cxc, div.Ww4FFb')
    for (const div of containers) {
      const h3 = div.querySelector('h3')
      const anchor = div.querySelector('a[href]')
      const snippetEl = div.querySelector('.VwiC3b, [data-sncf], .lEBKkf')
      const cite = div.querySelector('cite')
      if (h3 && anchor) {
        items.push({
          title: h3.textContent?.trim() || '',
          link: anchor.getAttribute('href') || '',
          displayUrl: cite?.textContent?.trim() || '',
          snippet: snippetEl?.textContent?.trim() || '',
        })
      }
    }
    const input = document.querySelector('textarea[name=q]') || document.querySelector('input[name=q]')
    return {
      query: (input as HTMLInputElement | HTMLTextAreaElement | null)?.value || '',
      resultCount: items.length,
      results: items,
    }
  })
}

/* ---------- searchImages ---------- */

async function searchImages(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const items: Array<{ sourceUrl: string; alt: string; width: number; height: number }> = []
    const containers = document.querySelectorAll('[data-lpage]')
    for (const div of containers) {
      const img = div.querySelector('img') as HTMLImageElement | null
      const sourceUrl = div.getAttribute('data-lpage') || ''
      const alt = img?.getAttribute('alt') || ''
      if (sourceUrl) {
        items.push({
          sourceUrl,
          alt,
          width: img?.naturalWidth || 0,
          height: img?.naturalHeight || 0,
        })
      }
    }
    const input = document.querySelector('textarea[name=q]') || document.querySelector('input[name=q]')
    return {
      query: (input as HTMLInputElement | HTMLTextAreaElement | null)?.value || '',
      resultCount: items.length,
      results: items,
    }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchWeb,
  searchImages,
}

const adapter: CodeAdapter = {
  name: 'google-search',
  description: 'Google Search — organic web results and image results via DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('google.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true // no auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
