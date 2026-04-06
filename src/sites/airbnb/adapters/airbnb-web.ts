import type { Page } from 'patchright'

// Self-contained types — avoid external imports so adapter works from compile cache
interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

/**
 * Airbnb adapter — SSR extraction from data-deferred-state-0 script tag.
 *
 * Search results and listing details are delivered via embedded JSON in
 * <script id="data-deferred-state-0"> rather than separate API calls.
 */

/** Navigate to an Airbnb URL and wait for SSR data to be present. */
async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForSelector('#data-deferred-state-0', { timeout: 10_000 }).catch(() => {})
}

/** Parse the SSR data from data-deferred-state-0. */
async function extractDeferredState(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const el = document.getElementById('data-deferred-state-0')
    if (!el?.textContent) return null
    try { return JSON.parse(el.textContent) } catch { return null }
  })
}

/* ---------- Search listings ---------- */

async function searchListings(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const url = new URL('https://www.airbnb.com/s/homes')
  url.searchParams.set('query', String(params.query ?? ''))
  if (params.checkin) url.searchParams.set('checkin', String(params.checkin))
  if (params.checkout) url.searchParams.set('checkout', String(params.checkout))
  if (params.adults) url.searchParams.set('adults', String(params.adults))
  if (params.children) url.searchParams.set('children', String(params.children))
  if (params.infants) url.searchParams.set('infants', String(params.infants))
  if (params.minPrice) url.searchParams.set('price_min', String(params.minPrice))
  if (params.maxPrice) url.searchParams.set('price_max', String(params.maxPrice))
  if (params.roomType) url.searchParams.set('room_types[]', String(params.roomType))

  await navigateTo(page, url.toString())

  return page.evaluate(() => {
    const el = document.getElementById('data-deferred-state-0')
    if (!el?.textContent) return { count: 0, listings: [] }
    const data = JSON.parse(el.textContent)
    const search = data?.niobeClientData?.[0]?.[1]?.data?.presentation?.staysSearch
    if (!search?.results?.searchResults) return { count: 0, listings: [] }

    const results = search.results.searchResults
    const listings = results.map((r: Record<string, unknown>) => {
      // Extract listing ID from base64-encoded demandStayListing.id
      let id: string | null = null
      const demandId = (r.demandStayListing as Record<string, unknown>)?.id as string | undefined
      if (demandId) {
        try {
          const decoded = atob(demandId)
          const match = decoded.match(/:(\d+)$/)
          if (match) id = match[1]
        } catch { /* skip */ }
      }

      const price = r.structuredDisplayPrice as Record<string, unknown> | undefined
      const primaryLine = price?.primaryLine as Record<string, unknown> | undefined
      const nameInfo = r.nameLocalized as Record<string, unknown> | undefined
      const demand = r.demandStayListing as Record<string, unknown> | undefined
      const location = demand?.location as Record<string, unknown> | undefined
      const coord = location?.coordinate as Record<string, unknown> | undefined
      const content = r.structuredContent as Record<string, unknown> | undefined
      const primaryContent = content?.primaryLine as Array<Record<string, unknown>> | undefined

      const pictures = (r.contextualPictures as Array<Record<string, unknown>> | undefined)
        ?.slice(0, 3)
        ?.map(p => p.picture as string)
        .filter(Boolean) ?? []

      const badges = (r.badges as Array<Record<string, unknown>> | undefined)
        ?.map(b => b.text as string)
        .filter(Boolean) ?? []

      return {
        id,
        title: r.title as string | null,
        name: nameInfo?.localizedStringWithTranslationPreference as string | null,
        rating: r.avgRatingLocalized as string | null,
        price: primaryLine?.price as string | null,
        priceQualifier: primaryLine?.qualifier as string | null,
        roomInfo: primaryContent?.map((c: Record<string, unknown>) => c.body as string).filter(Boolean) ?? [],
        badges,
        latitude: coord?.latitude as number | null,
        longitude: coord?.longitude as number | null,
        photos: pictures,
      }
    })

    const pagination = search.results.paginationInfo
    return {
      count: listings.length,
      hasNextPage: !!pagination?.nextPageCursor,
      listings,
    }
  })
}

/* ---------- Listing detail ---------- */

async function getListingDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id)
  const url = new URL(`https://www.airbnb.com/rooms/${id}`)
  if (params.checkin) url.searchParams.set('check_in', String(params.checkin))
  if (params.checkout) url.searchParams.set('check_out', String(params.checkout))
  if (params.adults) url.searchParams.set('adults', String(params.adults))

  await navigateTo(page, url.toString())

  return page.evaluate(`(function() {
    var el = document.getElementById('data-deferred-state-0');
    if (!el || !el.textContent) return null;
    var data = JSON.parse(el.textContent);
    var entry = data && data.niobeClientData && data.niobeClientData[0] && data.niobeClientData[0][1];
    if (!entry || !entry.data || !entry.data.presentation || !entry.data.presentation.stayProductDetailPage) return null;

    var pdp = entry.data.presentation.stayProductDetailPage;
    var sects = pdp.sections.sections;
    var metadata = pdp.sections.metadata;

    function fs(id) {
      for (var i = 0; i < sects.length; i++) {
        if (sects[i].sectionId === id) return sects[i].section;
      }
      return null;
    }

    var reviews = fs('REVIEWS_DEFAULT');
    var location = fs('LOCATION_DEFAULT');
    var host = fs('MEET_YOUR_HOST');
    var policies = fs('POLICIES_DEFAULT');
    var bookIt = fs('BOOK_IT_SIDEBAR');
    var highlights = fs('HIGHLIGHTS_DEFAULT');
    var description = fs('DESCRIPTION_DEFAULT');
    var amenities = fs('AMENITIES_DEFAULT');

    var sharingConfig = metadata && metadata.sharingConfig;
    var hostCard = host && host.cardData;
    var highlightsList = highlights && highlights.highlights;

    var ratings = [];
    if (reviews && reviews.ratings) {
      for (var i = 0; i < reviews.ratings.length; i++) {
        var r = reviews.ratings[i];
        ratings.push({ category: r.label, score: r.localizedRating });
      }
    }

    var amenityGroups = [];
    var groups = amenities && amenities.seeAllAmenitiesGroups;
    if (groups) {
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var items = [];
        if (g.amenities) {
          for (var j = 0; j < g.amenities.length; j++) {
            if (g.amenities[j].title) items.push(g.amenities[j].title);
          }
        }
        amenityGroups.push({ title: g.title, amenities: items });
      }
    }

    var amenityPreviews = [];
    if (amenityGroups.length === 0 && amenities && amenities.previewAmenitiesGroups) {
      var pg = amenities.previewAmenitiesGroups;
      for (var i = 0; i < pg.length; i++) {
        if (pg[i].amenities) {
          for (var j = 0; j < pg[i].amenities.length; j++) {
            if (pg[i].amenities[j].title) amenityPreviews.push(pg[i].amenities[j].title);
          }
        }
      }
    }

    var descText = null;
    if (description) {
      if (description.htmlDescription && description.htmlDescription.htmlText) {
        descText = description.htmlDescription.htmlText;
      } else if (description.description) {
        descText = description.description;
      }
    }

    return {
      title: sharingConfig ? sharingConfig.title : null,
      description: descText,
      overallRating: reviews ? reviews.overallRating : null,
      reviewCount: reviews ? reviews.overallCount : null,
      ratings: ratings,
      location: location ? {
        title: location.subtitle || null,
        latitude: location.lat || null,
        longitude: location.lng || null,
      } : null,
      host: hostCard ? {
        name: hostCard.name || null,
        isSuperhost: hostCard.isSuperhost || null,
        ratingAverage: hostCard.ratingAverage || null,
        ratingCount: hostCard.ratingCount || null,
      } : null,
      maxGuests: bookIt ? bookIt.maxGuestCapacity : null,
      highlights: highlightsList ? highlightsList.map(function(h) {
        return { title: h.title, subtitle: h.subtitle || null };
      }) : [],
      amenities: amenityGroups.length > 0 ? amenityGroups : amenityPreviews,
      cancellationPolicy: policies ? policies.cancellationPolicyForDisplay : null,
    };
  })()`)
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchListings,
  getListingDetail,
}

const adapter: CodeAdapter = {
  name: 'airbnb-web',
  description: 'Airbnb — SSR extraction for accommodation search and listing details',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('airbnb.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public browsing works without auth
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw unknownOpError(operation)
    return handler(page, { ...params })
  },
}

export default adapter
