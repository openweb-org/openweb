import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Home Depot adapter — LD+JSON and DOM extraction from browser-rendered pages.
 *
 * Product pages embed LD+JSON Product schema with rich data.
 * Search/browse pages use ProductPod DOM components.
 * Store pages embed LD+JSON LocalBusiness + FAQPage schemas.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

/* ---------- helpers ---------- */

function parseLdJson(scripts: NodeListOf<Element>): any[] {
  const results: any[] = []
  for (const s of scripts) {
    try {
      results.push(JSON.parse(s.textContent ?? ''))
    } catch { /* skip */ }
  }
  return results
}

/* ---------- Search ---------- */

async function searchProducts(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const pods = document.querySelectorAll('[data-component*="ProductPod"]')
    const seen = new Set<string>()
    const products: {
      name: string
      url: string
      price: string | null
      wasPrice: string | null
      savings: string | null
      rating: string | null
      reviewCount: string | null
      brand: string | null
      image: string | null
    }[] = []

    for (const pod of pods) {
      const titleEl = pod.querySelector('span[data-testid="attribute-product-label"]')
        || pod.querySelector('[data-testid="product-header"] span')
      const name = titleEl?.textContent?.trim()
      if (!name || name.length < 5) continue

      const link = pod.querySelector('a[href*="/p/"]') as HTMLAnchorElement | null
      const href = link?.href ?? ''
      if (seen.has(href)) continue
      seen.add(href)

      const priceText = pod.querySelector('[data-testid="price-format"]')?.textContent?.trim() ?? ''
      const priceMatch = priceText.match(/\$([\d,.]+)/)
      const wasMatch = priceText.match(/Was\s*\$([\d,.]+)/)
      const saveMatch = priceText.match(/Save\s*\$([\d,.]+)/)

      const ratingEl = pod.querySelector('[data-testid="ratings"], [aria-label*="star"]')
      const ratingText = ratingEl?.textContent?.trim() ?? ratingEl?.getAttribute('aria-label') ?? ''
      const ratingMatch = ratingText.match(/([\d.]+)\s*\/?\s*(\d+)?/)
      const reviewMatch = ratingText.match(/(\d[\d,]*)\)/)

      const brandEl = pod.querySelector('[data-testid="attribute-product-brand"]')
      const img = (pod.querySelector('img[src*="thdstatic.com"]') as HTMLImageElement)?.src ?? null

      products.push({
        name,
        url: href,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        wasPrice: wasMatch ? `$${wasMatch[1]}` : null,
        savings: saveMatch ? `$${saveMatch[1]}` : null,
        rating: ratingMatch?.[1] ?? null,
        reviewCount: reviewMatch?.[1]?.replace(/,/g, '') ?? null,
        brand: brandEl?.textContent?.trim() ?? null,
        image: img,
      })
    }

    return { count: products.length, products: products.slice(0, 30) }
  })
}

/* ---------- Product detail ---------- */

async function getProductDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Product') continue
        return {
          name: data.name ?? null,
          brand: data.brand?.name ?? null,
          description: data.description ?? null,
          productId: data.productID ?? null,
          sku: data.sku ?? null,
          model: data.model ?? null,
          gtin13: data.gtin13 ?? null,
          color: data.color ?? null,
          dimensions: {
            depth: data.depth ?? null,
            height: data.height ?? null,
            width: data.width ?? null,
          },
          weight: data.weight ?? null,
          rating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          price: data.offers?.price ?? null,
          priceCurrency: data.offers?.priceCurrency ?? null,
          image: Array.isArray(data.image) ? data.image[0] : data.image ?? null,
          url: data.offers?.url ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Product pricing ---------- */

async function getProductPricing(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Product') continue
        const offers = data.offers ?? {}
        const strikethrough = offers.priceSpecification ?? null
        return {
          price: offers.price ?? null,
          priceCurrency: offers.priceCurrency ?? null,
          priceValidUntil: offers.priceValidUntil ?? null,
          strikethroughPrice: strikethrough?.price ?? null,
          returnDays: offers.hasMerchantReturnPolicy?.merchantReturnDays ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Product reviews ---------- */

async function getProductReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Product') continue
        const reviews = (data.review ?? []).map((r: any) => ({
          rating: r.reviewRating?.ratingValue ?? null,
          author: r.author?.name ?? null,
          headline: r.headline ?? null,
          body: r.reviewBody ?? null,
        }))
        return {
          overallRating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          reviews,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Product images ---------- */

async function getProductImages(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Product') continue
        const images = Array.isArray(data.image) ? data.image : data.image ? [data.image] : []
        return { count: images.length, images }
      } catch { /* skip */ }
    }
    return { count: 0, images: [] }
  })
}

/* ---------- Product specifications ---------- */

async function getProductSpecs(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Product') continue
        return {
          model: data.model ?? null,
          sku: data.sku ?? null,
          gtin13: data.gtin13 ?? null,
          color: data.color ?? null,
          depth: data.depth ?? null,
          height: data.height ?? null,
          width: data.width ?? null,
          weight: data.weight ?? null,
          brand: data.brand?.name ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Departments ---------- */

async function getDepartments(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/b/"]')
    const seen = new Set<string>()
    const departments: { name: string; url: string }[] = []

    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 60 || seen.has(el.href)) continue
      if (el.href.includes('/b/') && !el.href.includes('?')) {
        seen.add(el.href)
        departments.push({ name, url: el.href })
      }
    }

    return { count: departments.length, departments: departments.slice(0, 40) }
  })
}

/* ---------- Store details ---------- */

async function getStoreDetails(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'LocalBusiness') continue
        return {
          name: data.aggregateRating?.itemReviewed ?? null,
          address: data.address
            ? {
                street: data.address.streetAddress ?? null,
                city: data.address.addressLocality ?? null,
                region: data.address.addressRegion ?? null,
                postalCode: data.address.postalCode ?? null,
              }
            : null,
          rating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          phone: data.telephone ?? null,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Store reviews ---------- */

async function getStoreReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'LocalBusiness') continue
        const reviews = (data.review ?? []).map((r: any) => ({
          author: r.author ?? null,
          title: r.name ?? null,
          body: r.reviewBody ?? null,
          rating: r.reviewRating?.ratingValue ?? null,
        }))
        return {
          storeName: data.aggregateRating?.itemReviewed ?? null,
          overallRating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          reviews,
        }
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Store FAQ ---------- */

async function getStoreFAQ(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'FAQPage') continue
        const questions = (data.mainEntity ?? []).map((q: any) => ({
          question: q.name ?? null,
          answer: q.acceptedAnswer?.text ?? null,
        }))
        return { count: questions.length, questions }
      } catch { /* skip */ }
    }
    return { count: 0, questions: [] }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getProductPricing,
  getProductReviews,
  getProductImages,
  getProductSpecs,
  getDepartments,
  getStoreDetails,
  getStoreReviews,
  getStoreFAQ,
}

const adapter: CodeAdapter = {
  name: 'homedepot-web',
  description: 'Home Depot — LD+JSON and DOM extraction for product search, details, pricing, reviews, store info',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('homedepot.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public browsing works without auth
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
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
