import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const STORE = 'https://store.steampowered.com'
const API = 'https://api.steampowered.com'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<R> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      const encoded = encodeURIComponent(String(v)).replace(/%2C/gi, ',')
      parts.push(`${k}=${encoded}`)
    }
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// ── Trim helpers ───────────────────────────────────────

function trimAppData(data: R): R {
  return {
    name: data.name,
    type: data.type,
    steam_appid: data.steam_appid,
    required_age: data.required_age,
    is_free: data.is_free,
    short_description: data.short_description,
    website: data.website,
    developers: data.developers,
    publishers: data.publishers,
    price_overview: data.price_overview ?? null,
    platforms: data.platforms,
    categories: data.categories,
    genres: data.genres,
    release_date: data.release_date,
    metacritic: data.metacritic ?? null,
    recommendations: data.recommendations ?? null,
  }
}

function trimReview(r: R): R {
  const author = r.author as R | undefined
  const text = String(r.review ?? '')
  return {
    recommendationid: r.recommendationid,
    author: author ? {
      steamid: author.steamid,
      playtime_forever: author.playtime_forever,
      num_reviews: author.num_reviews,
    } : null,
    language: r.language,
    review: text.length > 2000 ? `${text.slice(0, 2000)}…` : text,
    voted_up: r.voted_up,
    votes_up: r.votes_up,
    votes_funny: r.votes_funny,
    timestamp_created: r.timestamp_created,
    steam_purchase: r.steam_purchase,
  }
}

function trimFeaturedItem(item: R): R {
  return {
    id: item.id,
    name: item.name,
    discount_percent: item.discount_percent,
    original_price: item.original_price,
    final_price: item.final_price,
    currency: item.currency,
  }
}

function trimCategoryItems(cat: R | undefined): R | null {
  if (!cat) return null
  const items = cat.items as R[] | undefined
  return {
    name: cat.name,
    items: (items ?? []).slice(0, 5).map(trimFeaturedItem),
  }
}

function trimNewsItem(n: R): R {
  const contents = String(n.contents ?? '')
  return {
    gid: n.gid,
    title: n.title,
    url: n.url,
    author: n.author,
    contents: contents.length > 300 ? `${contents.slice(0, 300)}…` : contents,
    date: n.date,
    feedname: n.feedname,
  }
}

function trimDlcItem(d: R): R {
  return {
    id: d.id,
    name: d.name,
    price_overview: d.price_overview ?? null,
    platforms: d.platforms,
    release_date: d.release_date,
  }
}

// ── Operations ─────────────────────────────────────────

async function getAppDetails(params: Params, errors: Errors): Promise<unknown> {
  const appids = params.appids as string | undefined
  if (!appids) throw errors.missingParam('appids')
  const raw = await fetchJson(`${STORE}/api/appdetails${qs({ appids, cc: params.cc, l: params.l })}`, errors)

  const result: R = {}
  for (const [id, entry] of Object.entries(raw)) {
    const e = entry as R
    if (!e.success) { result[id] = { success: false }; continue }
    result[id] = { success: true, data: trimAppData(e.data as R) }
  }
  return result
}

async function searchGames(params: Params, errors: Errors): Promise<unknown> {
  const term = params.term as string | undefined
  if (!term) throw errors.missingParam('term')
  return fetchJson(`${STORE}/api/storesearch/${qs({ term, l: params.l, cc: params.cc })}`, errors)
}

async function getAppReviews(params: Params, errors: Errors): Promise<unknown> {
  const appid = params.appid as number | undefined
  if (!appid) throw errors.missingParam('appid')
  const raw = await fetchJson(
    `${STORE}/appreviews/${appid}${qs({
      json: 1,
      num_per_page: params.num_per_page,
      filter: params.filter,
      language: params.language,
      review_type: params.review_type,
      purchase_type: params.purchase_type,
    })}`,
    errors,
  )
  const reviews = raw.reviews as R[] | undefined
  return {
    query_summary: raw.query_summary,
    reviews: (reviews ?? []).map(trimReview),
  }
}

async function getFeatured(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${STORE}/api/featured/${qs({ cc: params.cc, l: params.l })}`, errors)
  return {
    featured_win: ((raw.featured_win as R[]) ?? []).slice(0, 5).map(trimFeaturedItem),
    featured_mac: ((raw.featured_mac as R[]) ?? []).slice(0, 5).map(trimFeaturedItem),
    featured_linux: ((raw.featured_linux as R[]) ?? []).slice(0, 5).map(trimFeaturedItem),
  }
}

async function getFeaturedCategories(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${STORE}/api/featuredcategories/${qs({ cc: params.cc, l: params.l })}`, errors)
  return {
    specials: trimCategoryItems(raw.specials as R),
    top_sellers: trimCategoryItems(raw.top_sellers as R),
    new_releases: trimCategoryItems(raw.new_releases as R),
    coming_soon: trimCategoryItems(raw.coming_soon as R),
  }
}

async function getPackageDetails(params: Params, errors: Errors): Promise<unknown> {
  const packageids = params.packageids as string | undefined
  if (!packageids) throw errors.missingParam('packageids')
  const raw = await fetchJson(`${STORE}/api/packagedetails${qs({ packageids, cc: params.cc })}`, errors)

  const result: R = {}
  for (const [id, entry] of Object.entries(raw)) {
    const e = entry as R
    if (!e.success) { result[id] = { success: false }; continue }
    const data = e.data as R
    result[id] = {
      success: true,
      data: { name: data.name, apps: data.apps, price: data.price, platforms: data.platforms },
    }
  }
  return result
}

async function getAppNews(params: Params, errors: Errors): Promise<unknown> {
  const appid = params.appid as number | undefined
  if (!appid) throw errors.missingParam('appid')
  const raw = await fetchJson(
    `${API}/ISteamNews/GetNewsForApp/v2/${qs({ appid, count: params.count, maxlength: params.maxlength, feeds: params.feeds })}`,
    errors,
  )
  const appnews = raw.appnews as R | undefined
  const newsitems = (appnews?.newsitems as R[]) ?? []
  return {
    appnews: {
      appid: appnews?.appid,
      count: newsitems.length,
      newsitems: newsitems.slice(0, 5).map(trimNewsItem),
    },
  }
}

async function getCurrentPlayers(params: Params, errors: Errors): Promise<unknown> {
  const appid = params.appid as number | undefined
  if (!appid) throw errors.missingParam('appid')
  return fetchJson(`${API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/${qs({ appid })}`, errors)
}

async function getGlobalAchievements(params: Params, errors: Errors): Promise<unknown> {
  const gameid = params.gameid as number | undefined
  if (!gameid) throw errors.missingParam('gameid')
  return fetchJson(`${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/${qs({ gameid })}`, errors)
}

async function getDlcForApp(params: Params, errors: Errors): Promise<unknown> {
  const appid = params.appid as number | undefined
  if (!appid) throw errors.missingParam('appid')
  const raw = await fetchJson(`${STORE}/api/dlcforapp/${qs({ appid })}`, errors)
  const dlc = raw.dlc as R[] | undefined
  return {
    appid: raw.appid,
    name: raw.name,
    dlc: (dlc ?? []).map(trimDlcItem),
  }
}

async function getPopularTags(_params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(`${STORE}/tagdata/populartags/english`, errors)
  const tags = raw as unknown as Array<{ tagid: number; name: string }>
  return tags.slice(0, 100)
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  getAppDetails,
  searchGames,
  getAppReviews,
  getFeatured,
  getFeaturedCategories,
  getPackageDetails,
  getAppNews,
  getCurrentPlayers,
  getGlobalAchievements,
  getDlcForApp,
  getPopularTags,
}

const adapter: CustomRunner = {
  name: 'steam',
  description: 'Steam Store — response trimming for all 11 read ops, auto-injects json=1 for reviews',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
