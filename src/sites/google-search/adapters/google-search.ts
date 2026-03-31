import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Google Search adapter — DOM extraction for search results.
 *
 * searchWeb:            Extract organic results from /search page
 * searchImages:         Extract image results from /search?udm=2 page
 * searchNews:           Extract news results from /search?tbm=nws page
 * searchVideos:         Extract video results from /search?tbm=vid page
 * searchShopping:       Extract shopping results from /search?udm=28 page
 * getKnowledgePanel:    Extract knowledge panel from /search page
 */
import type { CodeAdapter } from '../../../types/adapter.js'

/** Read the current query from the search input on the page. */
function readQuery(): string {
  const input = document.querySelector('textarea[name=q]') || document.querySelector('input[name=q]')
  return (input as HTMLInputElement | HTMLTextAreaElement | null)?.value || ''
}

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

/* ---------- searchNews ---------- */

async function searchNews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const items: Array<{ title: string; link: string; source: string; snippet: string; publishedAt: string }> = []
    const containers = document.querySelectorAll('div.SoaBEf')
    for (const div of containers) {
      const linkEl = div.querySelector('a.WlydOe')
      const titleEl = div.querySelector('.n0jPhd')
      const snippetEl = div.querySelector('.GI74Re')
      const sourceContainer = div.querySelector('.MgUUmf')
      const sourceNameEl = sourceContainer?.querySelector('.WJMUdc') || sourceContainer?.querySelector('span')
      const timeEl = div.querySelector('.OSrXXb span[data-ts]')
      if (titleEl && linkEl) {
        const ts = timeEl?.getAttribute('data-ts')
        items.push({
          title: titleEl.textContent?.trim() || '',
          link: linkEl.getAttribute('href') || '',
          source: sourceNameEl?.textContent?.trim() || '',
          snippet: snippetEl?.textContent?.trim() || '',
          publishedAt: ts ? new Date(Number(ts) * 1000).toISOString() : timeEl?.textContent?.trim() || '',
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

/* ---------- searchVideos ---------- */

async function searchVideos(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const items: Array<{ title: string; link: string; source: string; snippet: string }> = []
    const containers = document.querySelectorAll('.Ww4FFb')
    for (const div of containers) {
      const h3 = div.querySelector('h3')
      const anchor = div.querySelector('a[href]')
      const cite = div.querySelector('cite')
      const snippetEl = div.querySelector('.VwiC3b, [data-sncf]')
      if (h3 && anchor) {
        items.push({
          title: h3.textContent?.trim() || '',
          link: anchor.getAttribute('href') || '',
          source: cite?.textContent?.trim() || '',
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

/* ---------- searchShopping ---------- */

async function searchShopping(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const items: Array<{ title: string; price: string; originalPrice: string; merchant: string; reviewCount: string }> = []
    const units = document.querySelectorAll('.pla-unit')
    for (const unit of units) {
      const titleDiv = unit.querySelector('.bXPcId div')
      const priceEl = unit.querySelector('.VbBaOe')
      const origPriceEl = unit.querySelector('.tWaJ3e')
      const merchantEl = unit.querySelector('.UsGWMe') || unit.querySelector('.WJMUdc')
      const reviewEl = unit.querySelector('.yoARA')
      const title = titleDiv?.textContent?.trim() || ''
      if (title) {
        items.push({
          title,
          price: priceEl?.textContent?.trim() || '',
          originalPrice: origPriceEl?.textContent?.trim() || '',
          merchant: merchantEl?.textContent?.trim() || merchantEl?.getAttribute('aria-label')?.replace(/^From /, '') || '',
          reviewCount: reviewEl?.textContent?.trim() || '',
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

/* ---------- getKnowledgePanel ---------- */

async function getKnowledgePanel(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const title = document.querySelector('[data-attrid="title"]')?.textContent?.trim() || null
    const subtitle = document.querySelector('[data-attrid="subtitle"]')?.textContent?.trim() || null
    // SrpGenSumSummary has the clean AI-generated summary; fall back to first child of VisualDigest
    const descEl = document.querySelector('[data-attrid="SrpGenSumSummary"] span')
      || document.querySelector('[data-attrid="VisualDigestGeneratedDescription"] > div:first-child')
      || document.querySelector('[data-attrid="wa:/description"] .kno-rdesc span')
    const description = descEl?.textContent?.trim() || null
    const facts: Array<{ label: string; value: string }> = []
    const factRows = document.querySelectorAll('.rVusze')
    for (const row of factRows) {
      const labelEl = row.querySelector('.w8qArf')
      const valueEl = row.querySelector('.kno-fv, .LrzXr')
      const label = labelEl?.textContent?.replace(/:?\s*$/, '').trim() || ''
      const value = valueEl?.textContent?.trim() || ''
      if (label && value) facts.push({ label, value })
    }
    return { title, subtitle, description, facts }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchWeb,
  searchImages,
  searchNews,
  searchVideos,
  searchShopping,
  getKnowledgePanel,
}

const adapter: CodeAdapter = {
  name: 'google-search',
  description: 'Google Search — web, image, news, video, shopping results and knowledge panel via DOM extraction',

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
