/**
 * GoodRx adapter — DOM/JSON-LD extraction and GraphQL API via browser fetch.
 *
 * GoodRx is a Next.js App Router site with React Server Components.
 * Drug pricing data is server-rendered in the DOM; supplementary data
 * (articles, popular drugs) comes from a GraphQL API at graph.goodrx.com.
 * PerimeterX bot detection blocks direct HTTP — browser-only access.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { Page } from 'playwright-core'

/* ---------- DOM extraction operations ---------- */

async function getDrugPrices(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const lis = [...document.querySelectorAll('li')]
    const prices: { pharmacy: string; price: number; hasSpecialOffer: boolean }[] = []

    for (const li of lis) {
      const text = li.textContent?.trim() ?? ''
      if (!text.includes('$') || text.length > 200) continue
      const priceMatch = text.match(/\$(\d+\.\d{2})/)
      if (!priceMatch) continue
      const parts = text.split('$')
      const pharmacy = parts[0].replace(/Pay online$/i, '').trim()
      if (pharmacy.length < 2 || pharmacy.length > 60) continue
      prices.push({
        pharmacy,
        price: Number.parseFloat(priceMatch[1]),
        hasSpecialOffer: text.includes('Special offers'),
      })
    }
    return { count: prices.length, prices }
  })
}

async function getDrugInfo(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'Drug') continue
        return {
          name: data.name ?? null,
          alternateName: data.alternateName ?? null,
          description: data.description ?? null,
          drugClass: data.drugClass?.name ?? null,
          prescriptionStatus: data.prescriptionStatus ?? null,
          administrationRoute: data.administrationRoute ?? null,
          dosageForm: data.dosageForm ?? null,
          nonProprietaryName: data.nonProprietaryName ?? null,
          warning: data.warning ?? null,
          image: data.image?.contentUrl ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

async function getDrugOffers(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'Drug' || !data.offers) continue
        const offers = Array.isArray(data.offers) ? data.offers : [data.offers]
        return {
          drugName: data.name,
          count: offers.length,
          offers: offers.map((o: Record<string, unknown>) => ({
            price: o.price ?? null,
            priceCurrency: o.priceCurrency ?? null,
            availability: o.availability ?? null,
            validForMemberTier: (o.validForMemberTier as Record<string, unknown>)?.name ?? null,
            priceValidUntil: o.priceValidUntil ?? null,
            quantity: (o.eligibleQuantity as Record<string, unknown>)?.value ?? null,
            quantityUnit: (o.eligibleQuantity as Record<string, unknown>)?.unitText ?? null,
            form: ((o.additionalProperty as Record<string, unknown>[]) ?? []).find(
              (p: Record<string, unknown>) => p.name === 'form',
            )?.value ?? null,
            strength: ((o.additionalProperty as Record<string, unknown>[]) ?? []).find(
              (p: Record<string, unknown>) => p.name === 'strength',
            )?.value ?? null,
          })),
        }
      } catch { /* skip */ }
    }
    return null
  })
}

async function getDrugPricesByDosage(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const body = document.body.innerText
    const lines = body.split('\n')
    const entries: { dosage: string; quantity: string; retailPrice: string; goodrxPrice: string }[] = []

    for (const line of lines) {
      const match = line.match(/^(\d+\S*)\t(\d+\s+\w+)\t(\$[\d,.]+)\t(\$[\d,.]+)$/)
      if (match) {
        entries.push({
          dosage: match[1],
          quantity: match[2],
          retailPrice: match[3],
          goodrxPrice: match[4],
        })
      }
    }
    return { count: entries.length, entries }
  })
}

async function getHomeDeliveryPrices(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('[aria-label="List of home delivery prices"]')
    if (!section) return { count: 0, providers: [] }

    const items = [...section.querySelectorAll('li')]
    const providers: { name: string; price: number | null; details: string }[] = []

    for (const item of items) {
      const text = item.textContent?.trim() ?? ''
      const priceMatch = text.match(/\$(\d+\.\d{2})/)
      const name = text.split('$')[0]?.replace(/Pay online$/i, '').trim() ?? ''
      if (name.length < 2) continue
      providers.push({
        name,
        price: priceMatch ? Number.parseFloat(priceMatch[1]) : null,
        details: text,
      })
    }
    return { count: providers.length, providers }
  })
}

async function getDrugDescription(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'MedicalWebPage') continue
        return {
          name: data.name ?? null,
          description: data.description ?? null,
          url: data.url ?? null,
          datePublished: data.datePublished ?? null,
          dateModified: data.dateModified ?? null,
          lastReviewed: data.lastReviewed ?? null,
          author: data.author?.name ?? null,
          alternativeHeadline: data.alternativeHeadline ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

async function getDrugFAQ(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'FAQPage') continue
        const questions = (data.mainEntity ?? []).map((q: Record<string, unknown>) => ({
          question: (q as Record<string, string>).name ?? null,
          answer: ((q as Record<string, Record<string, string>>).acceptedAnswer)?.text ?? null,
        }))
        return { count: questions.length, questions }
      } catch { /* skip */ }
    }
    return { count: 0, questions: [] }
  })
}

/* ---------- DOM-based operations (replacing GraphQL) ---------- */

async function getDrugArticles(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  // Drug page has "Read more about {drug}" section with article links
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/health/"], a[href*="/conditions/"]')]
    const seen = new Set<string>()
    const items: { title: string; permalink: string; thumbnail: string | null }[] = []

    for (const a of links) {
      const href = (a as HTMLAnchorElement).href
      if (seen.has(href) || !href.includes('goodrx.com')) continue
      seen.add(href)
      const title = a.textContent?.trim() ?? ''
      if (title.length < 10 || title.length > 200) continue
      const img = a.querySelector('img')
      items.push({
        title,
        permalink: href,
        thumbnail: img?.src ?? null,
      })
    }
    return { total: items.length, items }
  })
}

async function getPopularDrugs(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  // Extract popular/trending drugs from the page (homepage or search page has them)
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')]
    const drugSlugs = new Set<string>()
    const drugs: { name: string; slug: string }[] = []

    for (const a of links) {
      const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
      // Match drug pages: /drug-name (single path segment, lowercase, no special chars)
      const match = href.match(/^\/([a-z][a-z0-9-]+)$/)
      if (!match) continue
      const slug = match[1]
      // Skip known non-drug pages
      if (['search', 'gold', 'care', 'brand', 'drugs', 'health', 'about', 'pets',
        'conditions', 'classes', 'mobile', 'discount-card', 'pharmacy-near-me',
        'how-goodrx-works', 'healthcare-professionals', 'out-of-pocket-costs'].includes(slug)) continue
      if (drugSlugs.has(slug)) continue
      drugSlugs.add(slug)
      const name = a.textContent?.trim() ?? ''
      if (name.length < 2 || name.length > 50) continue
      drugs.push({ name, slug })
    }
    return { count: drugs.length, drugs }
  })
}

async function getDrugConcept(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  // Extract drug concept info from the drug pricing page
  // The page header and meta has the drug name, recommended config, and lowest price
  return page.evaluate(() => {
    const title = document.querySelector('[data-qa="drug-price-header-title"]')?.textContent?.trim()
    const subtitle = document.querySelector('[data-qa="drug-price-header-subtitle"]')?.textContent?.trim()

    // Get lowest price from DOM
    const allText = document.body.innerText
    const lowestMatch = allText.match(/as low as (\$[\d.]+)/i)
    const lowestPrice = lowestMatch ? lowestMatch[1] : null

    // Get drug schema for more info
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    let drugName: string | null = null
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] === 'Drug') {
          drugName = data.name
          break
        }
      } catch { /* skip */ }
    }

    return {
      drugName: drugName ?? title ?? null,
      configDisplayText: subtitle ?? null,
      lowestPrice,
    }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> =
  {
    getDrugPrices,
    getDrugInfo,
    getDrugOffers,
    getDrugPricesByDosage,
    getHomeDeliveryPrices,
    getDrugDescription,
    getDrugFAQ,
    getDrugArticles,
    getPopularDrugs,
    getDrugConcept,
  }

const adapter: CodeAdapter = {
  name: 'goodrx-web',
  description: 'GoodRx drug pricing — DOM/JSON-LD extraction and GraphQL API',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('goodrx.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No auth required for public drug pricing
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
