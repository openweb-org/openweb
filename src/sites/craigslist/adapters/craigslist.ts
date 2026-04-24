import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

type AdapterErrors = { botBlocked(msg: string): Error; unknownOp(op: string): Error; wrap(error: unknown): Error }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

async function fetchHtml(url: string, errors: AdapterErrors): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw errors.wrap(new Error(`HTTP ${res.status} for ${url}`))
  const html = await res.text()
  if (html.includes('/captcha') || html.includes('blocked.html')) {
    throw errors.botBlocked('Blocked by Craigslist')
  }
  return html
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function trimText(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function normalizePrice(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned || Number(cleaned) === 0) return null
  return raw
}

const MAX_SEARCH_RESULTS = 25
const MAX_BODY = 800
const MAX_IMAGES = 5

// ── searchListings ─────────────────────────────────────────────────

async function searchListings(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  const category = params.category as string
  const query = params.query as string | undefined
  const qs = query ? `?query=${encodeURIComponent(query)}` : ''
  const html = await fetchHtml(`https://${city}.craigslist.org/search/${category}${qs}`, errors)

  const listings: Record<string, unknown>[] = []

  // Parse cl-static-search-result elements (server-rendered, always present without JS)
  const resultRe = /class="cl-static-search-result"[^>]*title="([^"]*)">\s*<a href="([^"]*)">\s*<div class="title">([^<]*)<\/div>\s*<div class="details">\s*(?:<div class="price">([^<]*)<\/div>)?\s*(?:<div class="location">\s*([^<]*?)\s*<\/div>)?/g
  let m: RegExpExecArray | null
  for (m = resultRe.exec(html); m !== null; m = resultRe.exec(html)) {
    if (listings.length >= MAX_SEARCH_RESULTS) break
    const url = m[2]
    const idMatch = url.match(/\/(\d+)\.html/)
    listings.push({
      title: unescapeHtml(m[3].trim()),
      url,
      price: normalizePrice(m[4]?.trim() || null),
      location: m[5]?.trim() || null,
      postId: idMatch ? idMatch[1] : null,
    })
  }

  return { resultCount: listings.length, listings }
}

// ── getListing ──────────────────────────────────────────────────────

async function getListing(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  const category = params.category as string
  const slug = params.slug as string
  const id = params.id as string
  const url = `https://${city}.craigslist.org/${category}/d/${slug}/${id}.html`
  const html = await fetchHtml(url, errors)

  // Title
  const titleMatch = html.match(/id="titletextonly">([^<]+)/)
  const title = titleMatch ? unescapeHtml(titleMatch[1].trim()) : ''

  // Price
  const priceMatch = html.match(/class="price">([^<]+)/)
  const price = priceMatch ? priceMatch[1].trim() : null

  // Body — extract text between postingbody div and its closing tag, strip inner HTML
  let body = ''
  const bodyStart = html.indexOf('id="postingbody">')
  if (bodyStart !== -1) {
    const contentStart = bodyStart + 'id="postingbody">'.length
    const bodyEnd = html.indexOf('</section>', contentStart)
    if (bodyEnd !== -1) {
      body = html
        .substring(contentStart, bodyEnd)
        .replace(/<div class="print-information[\s\S]*?<\/div>\s*<\/div>/g, '') // remove QR code block
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      body = unescapeHtml(body)
    }
  }

  // Location
  const mapAddrMatch = html.match(/class="mapaddress">([^<]+)/)
  const location = mapAddrMatch ? unescapeHtml(mapAddrMatch[1].trim()) : null

  // Coordinates
  const latMatch = html.match(/data-latitude="([^"]+)"/)
  const lngMatch = html.match(/data-longitude="([^"]+)"/)
  const latitude = latMatch ? Number(latMatch[1]) || null : null
  const longitude = lngMatch ? Number(lngMatch[1]) || null : null

  // Timestamps
  let postedAt: string | null = null
  let updatedAt: string | null = null
  const timeRe = /<p class="postinginfo[^"]*">([^<]*)<time[^>]*datetime="([^"]+)"/g
  let tm: RegExpExecArray | null
  for (tm = timeRe.exec(html); tm !== null; tm = timeRe.exec(html)) {
    const label = tm[1]
    const dt = tm[2]
    if (label.includes('posted')) postedAt = dt
    if (label.includes('updated')) updatedAt = dt
  }

  // Attributes
  const attributes: string[] = []
  const attrRe = /class="valu">\s*(?:<a[^>]*>)?([^<]+)/g
  let am: RegExpExecArray | null
  for (am = attrRe.exec(html); am !== null; am = attrRe.exec(html)) {
    const text = am[1].trim()
    if (text) attributes.push(unescapeHtml(text))
  }

  // Images — from thumbs links (full-size href)
  const images: string[] = []
  const imgRe = /id="thumbs">([\s\S]*?)<\/div>/
  const thumbsMatch = html.match(imgRe)
  if (thumbsMatch) {
    const hrefRe = /href="(https:\/\/images\.craigslist\.org[^"]+_600x450\.jpg)"/g
    let im: RegExpExecArray | null
    for (im = hrefRe.exec(thumbsMatch[1]); im !== null; im = hrefRe.exec(thumbsMatch[1])) {
      images.push(im[1])
    }
  }

  return { title, price, body: trimText(body, MAX_BODY), location, latitude, longitude, postedAt, updatedAt, attributes, images: images.slice(0, MAX_IMAGES), url }
}

// ── getCategories ──────────────────────────────────────────────────

async function getCategories(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  const html = await fetchHtml(`https://${city}.craigslist.org/`, errors)

  const categories: { name: string; code: string; section: string | null }[] = []
  const seen = new Set<string>()
  let currentSection: string | null = null

  // Match all <a data-cat="xxx"><span class="txt">Name elements, detect section by looking for <h3 before the <a
  const catRe = /<a[^>]*data-cat="(\w+)"[^>]*><span class="txt">([^<]+)/g
  let lm: RegExpExecArray | null
  for (lm = catRe.exec(html); lm !== null; lm = catRe.exec(html)) {
    const code = lm[1]
    const rawName = unescapeHtml(lm[2].trim())
    // Check if this <a> is inside an <h3> by looking at preceding 40 chars
    const preceding = html.substring(Math.max(0, lm.index - 40), lm.index)
    const isSection = /<h3[^>]*>\s*$/.test(preceding)
    if (isSection) {
      currentSection = rawName
    }
    if (!seen.has(code)) {
      seen.add(code)
      categories.push({ name: rawName, code, section: currentSection })
    }
  }

  return { city, categories }
}

// ── Adapter registration ───────────────────────────────────────────

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>> = {
  searchListings,
  getListing,
  getCategories,
}

const adapter: CustomRunner = {
  name: 'craigslist',
  description: 'Craigslist — node fetch + HTML parse, zero browser dependency',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page as Page, { ...params }, errors)
  },
}

export default adapter
