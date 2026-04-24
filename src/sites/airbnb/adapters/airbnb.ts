import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

type AdapterErrors = {
  unknownOp(op: string): Error
  wrap(error: unknown): Error
}

/* ---------- constants ---------- */

const NODE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

/* ---------- response trimming ---------- */

const STRIP_KEYS = new Set([
  '__typename', 'loggingData', 'loggingMetadata', 'loggingContext',
  'clientLoggingContext', 'seoFeatures', 'bookingPrefetchData',
  'wishlistItems', 'passportData', 'listingParamOverrides',
  'experiments', 'sbuiData',
])

function trimResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(trimResponse)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(k)) continue
      out[k] = trimResponse(v)
    }
    return out
  }
  return obj
}

/* ---------- SSR parsing ---------- */

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

/* ---------- search trimming ---------- */

const SEARCH_KEEP_KEYS = new Set(['searchResults', 'paginationInfo'])

function trimSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) {
    if (SEARCH_KEEP_KEYS.has(k)) out[k] = raw[k]
  }
  return trimResponse(out) as Record<string, unknown>
}

/* ---------- detail trimming ---------- */

const DETAIL_DROP_SECTIONS = new Set([
  'BOOK_IT_SIDEBAR', 'BOOK_IT_NAV', 'BOOK_IT_FLOATING_FOOTER',
  'BOOK_IT_CALENDAR_SHEET', 'NAV_DEFAULT', 'NAV_MOBILE',
  'URGENCY_COMMITMENT', 'URGENCY_COMMITMENT_SIDEBAR',
  'REPORT_TO_AIRBNB', 'SEO_LINKS_DEFAULT',
  'CANCELLATION_POLICY_PICKER_MODAL', 'PHOTO_TOUR_SCROLLABLE_MODAL',
  'WHAT_COUNTS_AS_A_PET_MODAL', 'SIMILAR_LISTINGS_CAROUSEL',
  'GUEST_FAVORITE_BANNER', 'MESSAGE_BANNER', 'UGC_TRANSLATION',
])

const DETAIL_DROP_CONTAINER_KEYS = new Set([
  'sectionsV2', 'screens', 'screensV2', 'flows', 'sbuiData',
])

const SECTION_WRAPPER_DROP = new Set([
  'id', 'sectionComponentType', 'sectionContentStatus', 'errors',
  'sectionDependencies', 'enableDependencies', 'disableDependencies',
  'e2eLoggingSession', 'mutationMetadata', 'pluginPointId',
])

const MAX_HERO_IMAGES = 10

function trimSection(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (SECTION_WRAPPER_DROP.has(k)) continue
    out[k] = v
  }
  const sec = out.section as Record<string, unknown> | undefined
  if (sec?.previewImages && Array.isArray(sec.previewImages)) {
    const { carouselImageNavigationLoggingEventData: _, previewImageLoggingEventData: __, ...rest } = sec
    rest.previewImages = (rest.previewImages as unknown[]).slice(0, MAX_HERO_IMAGES)
    out.section = rest
  }
  return out
}

function trimDetail(raw: Record<string, unknown>): Record<string, unknown> {
  const sections = raw.sections as Record<string, unknown> | undefined
  if (!sections) return trimResponse(raw) as Record<string, unknown>

  const inner = { ...sections }
  for (const k of DETAIL_DROP_CONTAINER_KEYS) delete inner[k]

  if (Array.isArray(inner.sections)) {
    inner.sections = (inner.sections as Array<Record<string, unknown>>)
      .filter(s => !DETAIL_DROP_SECTIONS.has(String(s.sectionId ?? '')))
      .map(s => trimSection(s as Record<string, unknown>))
  }

  const trimmed = trimResponse({ sections: inner }) as Record<string, unknown>
  const trimmedSections = (trimmed as any).sections?.sections
  if (Array.isArray(trimmedSections)) {
    ;(trimmed as any).sections.sections = trimmedSections.filter((s: any) => {
      const sec = s.section
      return sec && (typeof sec !== 'object' || Object.keys(sec).length > 0)
    })
  }
  return trimmed
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

  const results = (pres.staysSearch as Record<string, unknown>).results as Record<string, unknown> | undefined
  if (!results) throw new Error('Failed to extract search results from SSR')
  return trimSearch(results)
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

  return trimDetail(pres.stayProductDetailPage as Record<string, unknown>)
}

/* ---------- host profile parsing ---------- */

function parseHostProfile(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*id="data-injector-instances"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const d = JSON.parse(match[1])
    const root = d?.root
    if (!root || typeof root !== 'object') return null
    for (const val of Object.values(root)) {
      if (!Array.isArray(val) || val[0] !== 'NiobeClientToken') continue
      const entries = val[1]
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const container = entry?.[1]?.data?.presentation?.userProfileContainer
        if (container?.userProfile) return container.userProfile as Record<string, unknown>
      }
    }
    return null
  } catch {
    return null
  }
}

const HOST_PROFILE_DROP = new Set([
  'allInterestsList', 'rankedInterests', 'travelGuides',
  'isAutoTranslationEnabled', 'isViewerProfileOwner', 'flaggedByViewer',
  'canViewProfilePicture', 'hasProfilePicture', 'guestType',
  'fieldRankings', 'preference', 'localizedAbout',
  'reviewHighlightsFromGuests', 'reviewHighlightsFromHosts',
])

function trimHostProfile(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (HOST_PROFILE_DROP.has(k)) continue
    out[k] = v
  }
  return trimResponse(out) as Record<string, unknown>
}

async function getHostProfile(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const hostId = String(params.hostId ?? '')
  const url = `https://www.airbnb.com/users/show/${encodeURIComponent(hostId)}`

  const resp = await fetch(url, {
    headers: { ...NODE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
  })
  if (resp.status !== 200) throw new Error(`Host profile page returned ${resp.status}`)

  const html = await resp.text()
  const profile = parseHostProfile(html)
  if (!profile) throw new Error('Failed to extract host profile from SSR')

  return { hostId, profile: trimHostProfile(profile) }
}

/* ---------- dispatch ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchListings,
  getListingDetail,
  getHostProfile,
}

const adapter: CustomRunner = {
  name: 'airbnb',
  description: 'Airbnb — Node SSR HTML fetch for search, listing detail, and host profile.',

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
