import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'
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

/* ---------- getPeopleAlsoAsk ---------- */

async function getPeopleAlsoAsk(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const items: Array<{ question: string }> = []
    const seen = new Set<string>()
    // Each .related-question-pair is one PAA row; question text lives in .dnXCYb
    const rows = document.querySelectorAll('.related-question-pair')
    for (const row of rows) {
      const textEl = row.querySelector('.dnXCYb') || row.querySelector('span[jsname="r4nke"]')
      const q = textEl?.textContent?.trim() || ''
      if (q && !seen.has(q)) { seen.add(q); items.push({ question: q }) }
    }
    return { questions: items, count: items.length }
  })
}

/* ---------- getRelatedSearches ---------- */

async function getRelatedSearches(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await navigateToSearch(page, String(params.q ?? ''))
  return page.evaluate(() => {
    const items: string[] = []
    // Related searches live in #botstuff; .AJLUJb / .oIk2Cb / .EIaa9b hold the links
    const links = document.querySelectorAll('#botstuff .AJLUJb a, .oIk2Cb a, .EIaa9b a')
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
    // Use .VkpGBb as the card container (contains .rllt__details inside)
    const cards = document.querySelectorAll('[jscontroller="AtSb"] .VkpGBb')
    for (const card of cards) {
      const details = card.querySelector('.rllt__details')
      if (!details) continue
      const nameEl = details.querySelector('[role="heading"], .dbg0pd, .OSrXXb')
      const ratingEl = details.querySelector('.MW4etd, .yi40Hd')
      const reviewsEl = details.querySelector('.UY7F9, .RDApEe')
      // Structure: div[0]=name, div[1]=rating row, div[2]=type/price, div[3]=address
      // Type/price/address are in the last two child divs after name and rating
      const divs = Array.from(details.children) as HTMLElement[]
      const name = nameEl?.textContent?.trim() || ''
      if (name) {
      // div[1] has "rating · price · type" inline; extract type from after last " · "
      const infoText = divs[1]?.textContent?.trim() || ''
      const infoParts = infoText.split(/\s*·\s*/)
      const type = infoParts.length > 1 ? infoParts[infoParts.length - 1] : ''
        items.push({
          name,
          rating: ratingEl?.textContent?.trim() || '',
          reviews: reviewsEl?.textContent?.trim().replace(/[()]/g, '') || '',
          type,
          address: divs[2]?.textContent?.trim() || '',
        })
      }
    }
    return { results: items, resultCount: items.length }
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
  getPeopleAlsoAsk,
  getRelatedSearches,
  searchLocal,
}

const adapter: CustomRunner = {
  name: 'google-search',
  description: 'Google Search — web, image, news, video, shopping, local, knowledge panel, PAA, related searches via DOM extraction',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: { unknownOp(op: string): Error; wrap(error: unknown): Error } }
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw errors.unknownOp(operation)
      return await handler(page as Page, { ...params })
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
