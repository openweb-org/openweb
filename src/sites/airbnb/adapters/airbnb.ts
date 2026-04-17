import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Airbnb adapter — Node HTML SSR extraction + browser host-profile fetch.
 *
 * Search and listing detail: node HTML fetch + SSR parsing (#data-deferred-state-0).
 * Host profile: browser page navigation + SSR extraction (bot detection blocks node).
 * Reviews and availability: spec-driven Relay GET APQ (see openapi.yaml; no adapter here).
 */

type AdapterErrors = {
  unknownOp(op: string): Error
  wrap(error: unknown): Error
}

/* ---------- constants ---------- */

const NODE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

/* ---------- SSR parsing ---------- */

/** Parse presentation object from Airbnb's SSR HTML (#data-deferred-state-0). */
function parsePresentation(html: string): Record<string, unknown> | null {
  const match = html.match(/<script\s+id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const data = JSON.parse(match[1])
    const client = data?.niobeClientData
    if (!Array.isArray(client)) return null
    for (const entry of client) {
      const pres = entry?.[1]?.data?.presentation
      if (pres) return pres as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/* ---------- operations ---------- */

async function searchListings(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const qp = new URLSearchParams()
  if (params.checkin) qp.set('checkin', String(params.checkin))
  if (params.checkout) qp.set('checkout', String(params.checkout))
  if (params.adults) qp.set('adults', String(params.adults))
  if (params.children) qp.set('children', String(params.children))
  if (params.infants) qp.set('infants', String(params.infants))
  if (params.price_min) qp.set('price_min', String(params.price_min))
  if (params.price_max) qp.set('price_max', String(params.price_max))
  if (params['room_types[]']) qp.set('room_types[]', String(params['room_types[]']))

  const qs = qp.toString()
  const url = `https://www.airbnb.com/s/${encodeURIComponent(query)}/homes${qs ? `?${qs}` : ''}`

  const resp = await fetch(url, {
    headers: { ...NODE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
  })
  if (resp.status !== 200) throw new Error(`Search page returned ${resp.status}`)

  const html = await resp.text()
  const pres = parsePresentation(html)
  if (!pres?.staysSearch) throw new Error('Failed to extract search results from SSR')

  return (pres.staysSearch as Record<string, unknown>).results
}

async function getListingDetail(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  const qp = new URLSearchParams()
  if (params.check_in) qp.set('check_in', String(params.check_in))
  if (params.check_out) qp.set('check_out', String(params.check_out))
  if (params.adults) qp.set('adults', String(params.adults))

  const qs = qp.toString()
  const url = `https://www.airbnb.com/rooms/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`

  const resp = await fetch(url, {
    headers: { ...NODE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
  })
  if (resp.status !== 200) throw new Error(`Listing page returned ${resp.status}`)

  const html = await resp.text()
  const pres = parsePresentation(html)
  if (!pres?.stayProductDetailPage) throw new Error('Failed to extract listing detail from SSR')

  return pres.stayProductDetailPage
}

async function getListingReviews(_page: Page, _params: Record<string, unknown>): Promise<unknown> {
  throw new Error('getListingReviews is spec-driven (Relay GET APQ) — this adapter path should not be invoked.')
}

async function getListingAvailability(_page: Page, _params: Record<string, unknown>): Promise<unknown> {
  throw new Error('getListingAvailability is spec-driven (Relay GET APQ) — this adapter path should not be invoked.')
}

async function getHostProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const hostId = String(params.hostId ?? '')
  const url = `https://www.airbnb.com/users/show/${encodeURIComponent(hostId)}`
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(3000)

  const presentation = await page.evaluate(() => {
    // Strategy 1: data-deferred-state tags
    for (let i = 0; i < 5; i++) {
      const el = document.querySelector(`#data-deferred-state-${i}`)
      if (!el?.textContent) continue
      try {
        const data = JSON.parse(el.textContent)
        const client = data?.niobeClientData
        if (!Array.isArray(client)) continue
        for (const entry of client) {
          const pres = entry?.[1]?.data?.presentation
          if (pres) return pres
        }
      } catch { /* continue */ }
    }
    // Strategy 2: __NEXT_DATA__
    const next = document.querySelector('#__NEXT_DATA__')
    if (next?.textContent) {
      try { return JSON.parse(next.textContent) } catch { /* continue */ }
    }
    // Strategy 3: any large application/json script
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if ((script.textContent ?? '').length > 200) {
        try { return JSON.parse(script.textContent ?? '') } catch { /* continue */ }
      }
    }
    return null
  })

  if (!presentation) throw new Error('Failed to extract host profile data from page')
  return { hostId, profile: presentation }
}

/* ---------- dispatch ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchListings,
  getListingDetail,
  getListingReviews,
  getListingAvailability,
  getHostProfile,
}

const adapter: CustomRunner = {
  name: 'airbnb',
  description: 'Airbnb — Node API + SSR HTML fetch. Browser only for host profile.',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    try {
      return await handler(page as Page, { ...params })
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
