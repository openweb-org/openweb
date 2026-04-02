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

/** Navigate to a Google search URL and wait for results to load. */
async function navigateToSearch(page: Page, q: string, extra?: Record<string, string>): Promise<void> {
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', q)
  if (extra) for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 })
  // Wait for search results or knowledge panel to appear
  await page.waitForSelector('#search, #rso, [data-attrid="title"], #wob_wc', { timeout: 10_000 }).catch(() => {})
}

/* ---------- searchWeb ---------- */

async function searchWeb(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
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

async function searchImages(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''), { udm: '2' })
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

async function searchNews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''), { tbm: 'nws' })
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

async function searchVideos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''), { tbm: 'vid' })
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

async function searchShopping(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''), { udm: '28' })
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

async function getKnowledgePanel(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
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

/* ---------- getFeaturedSnippet ---------- */

async function getFeaturedSnippet(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const container = document.querySelector('.xpdopen .hgKElc')
      || document.querySelector('[data-attrid="wa:/description"] .kno-rdesc span')
      || document.querySelector('.IZ6rdc')
    const titleEl = document.querySelector('.xpdopen .LC20lb')
      || document.querySelector('.ifM9O .r21Kzd')
    const sourceEl = document.querySelector('.xpdopen cite')
    const linkEl = document.querySelector('.xpdopen a[href]')
    return {
      snippet: container?.textContent?.trim() || null,
      title: titleEl?.textContent?.trim() || null,
      sourceUrl: linkEl?.getAttribute('href') || null,
      displayUrl: sourceEl?.textContent?.trim() || null,
    }
  })
}

/* ---------- getPeopleAlsoAsk ---------- */

async function getPeopleAlsoAsk(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const items: Array<{ question: string }> = []
    const rows = document.querySelectorAll('[jsname="Cpkphb"] [data-q], .related-question-pair [data-q]')
    for (const row of rows) {
      const q = row.getAttribute('data-q') || row.textContent?.trim() || ''
      if (q) items.push({ question: q })
    }
    // Fallback: aria-expanded divs
    if (items.length === 0) {
      const expandables = document.querySelectorAll('[jsname="Cpkphb"] [role="button"]')
      for (const el of expandables) {
        const text = el.textContent?.trim() || ''
        if (text) items.push({ question: text })
      }
    }
    return { questions: items, count: items.length }
  })
}

/* ---------- getRelatedSearches ---------- */

async function getRelatedSearches(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const items: string[] = []
    const links = document.querySelectorAll('#brs a, .k8XOCe a, [data-ved] .s75CSd a')
    for (const a of links) {
      const text = a.textContent?.trim() || ''
      if (text && !items.includes(text)) items.push(text)
    }
    return { searches: items, count: items.length }
  })
}

/* ---------- searchLocal ---------- */

async function searchLocal(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const items: Array<{ name: string; rating: string; reviews: string; type: string; address: string }> = []
    const cards = document.querySelectorAll('[jscontroller="AtSb"] .VkpGBb, .rllt__details')
    for (const card of cards) {
      const nameEl = card.querySelector('[role="heading"], .dbg0pd, .OSrXXb')
      const ratingEl = card.querySelector('.MW4etd, .yi40Hd')
      const reviewsEl = card.querySelector('.UY7F9, .RDApEe')
      const typeEl = card.querySelector('.rllt__details > div:nth-child(2), .W4Efsd > span:first-child')
      const addrEl = card.querySelector('.rllt__details > div:nth-child(3), .W4Efsd > span:nth-child(2)')
      const name = nameEl?.textContent?.trim() || ''
      if (name) {
        items.push({
          name,
          rating: ratingEl?.textContent?.trim() || '',
          reviews: reviewsEl?.textContent?.trim().replace(/[()]/g, '') || '',
          type: typeEl?.textContent?.trim() || '',
          address: addrEl?.textContent?.trim() || '',
        })
      }
    }
    return { results: items, resultCount: items.length }
  })
}

/* ---------- getCalculation ---------- */

async function getCalculation(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    // Calculator / unit converter / currency converter widget
    const resultEl = document.querySelector('#cwos, .qv3Wpe, .dDoNo .vXQmIe, .dDoNo [data-value]')
    const formulaEl = document.querySelector('.vUGUtc, .bjhkR, .dDoNo .vk_bk')
    // Currency / unit conversion
    const fromEl = document.querySelector('#knowledge-currency__src-input, .CWGqFd input')
    const toEl = document.querySelector('#knowledge-currency__tgt-input, .dDoNo .vk_bk .SwHCTb')
    const fromUnit = document.querySelector('#knowledge-currency__src-selector, .vLqKYe select')
    const toUnit = document.querySelector('#knowledge-currency__tgt-selector, .bjhkR select')
    return {
      result: resultEl?.textContent?.trim() || toEl?.getAttribute('value') || null,
      expression: formulaEl?.textContent?.trim() || fromEl?.getAttribute('value') || null,
      fromUnit: fromUnit?.textContent?.trim() || null,
      toUnit: toUnit?.textContent?.trim() || null,
    }
  })
}

/* ---------- getWeather ---------- */

async function getWeather(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const container = document.querySelector('#wob_wc')
    if (!container) return { location: null, temperature: null, condition: null, humidity: null, wind: null }
    const location = container.querySelector('#wob_loc')?.textContent?.trim() || null
    const temp = container.querySelector('#wob_tm')?.textContent?.trim() || null
    const unit = container.querySelector('.wob_t')?.textContent?.includes('°F') ? 'F' : 'C'
    const condition = container.querySelector('#wob_dc')?.textContent?.trim() || null
    const humidity = container.querySelector('#wob_hm')?.textContent?.trim() || null
    const wind = container.querySelector('#wob_ws')?.textContent?.trim() || null
    const precipitation = container.querySelector('#wob_pp')?.textContent?.trim() || null
    return { location, temperature: temp ? `${temp}°${unit}` : null, condition, humidity, wind, precipitation }
  })
}

/* ---------- getTranslation ---------- */

async function getTranslation(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const container = document.querySelector('#tw-container, .MERaBe')
    if (!container) return { sourceText: null, translatedText: null, sourceLang: null, targetLang: null }
    const sourceText = container.querySelector('#tw-source-text-ta, .tw-src-ltr span')?.textContent?.trim() || null
    const translatedText = container.querySelector('#tw-target-text .Y2IQFc, .tw-ta-container .Y2IQFc, .result-container .tw-ta-text-message-container')?.textContent?.trim() || null
    const sourceLang = container.querySelector('#tw-sl, .source-language .jfk-button-checked')?.textContent?.trim() || null
    const targetLang = container.querySelector('#tw-tl, .target-language .jfk-button-checked')?.textContent?.trim() || null
    return { sourceText, translatedText, sourceLang, targetLang }
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
  getFeaturedSnippet,
  getPeopleAlsoAsk,
  getRelatedSearches,
  searchLocal,
  getCalculation,
  getWeather,
  getTranslation,
}

const adapter: CodeAdapter = {
  name: 'google-search',
  description: 'Google Search — web, image, news, video, shopping, local, knowledge panel, featured snippets, PAA, weather, calculator, translation via DOM extraction',

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
