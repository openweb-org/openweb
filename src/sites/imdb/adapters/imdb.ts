import type { Page } from 'patchright'

import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { AdapterHelpers, CustomRunner } from '../../../types/adapter.js'

const GQL_URL = 'https://api.graphql.imdb.com/'

// ── GraphQL helpers ─────────────────────────────────

async function gql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const result = await nodeFetch({
    url: GQL_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  })
  const json = JSON.parse(result.text) as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) throw new Error(`IMDb GraphQL: ${json.errors[0].message}`)
  if (!json.data) throw new Error('IMDb GraphQL: empty response')
  return json.data
}

// ── Fragments ───────────────────────────────────────

const TITLE_SEARCH_FIELDS = `
  id
  titleText { text }
  titleType { text id }
  releaseYear { year }
  ratingsSummary { aggregateRating voteCount }
  runtime { seconds }
  certificate { rating }
  genres { genres { text } }
`

const TITLE_CORE_FIELDS = `
  id
  titleText { text }
  originalTitleText { text }
  titleType { text id }
  releaseYear { year endYear }
  ratingsSummary { aggregateRating voteCount }
  runtime { seconds displayableProperty { value { plainText } } }
  certificate { rating }
  genres { genres { text } }
  plot { plotText { plainText } }
  primaryImage { url }
`

const TITLE_DETAIL_FIELDS = `
  ${TITLE_CORE_FIELDS}
  releaseDate { day month year }
  keywords(first: 20) { edges { node { text } } }
  principalCredits {
    category { text }
    credits(limit: 10) {
      name { id nameText { text } }
    }
  }
  reviews(first: 0) { total }
  nominations(first: 0) { total }
  prestigiousAwardSummary { wins nominations }
`

// ── Helpers ─────────────────────────────────────────

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v
  }
  return out as Partial<T>
}

// ── Operations ──────────────────────────────────────

async function searchTitles(_page: Page | null, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw new Error('q parameter is required')

  const data = await gql<{ mainSearch: { edges: Array<{ node: { entity: Record<string, any> } }> } }>(`
    query SearchTitles($term: String!) {
      mainSearch(first: 20, options: { searchTerm: $term, type: TITLE }) {
        edges { node { entity { ... on Title { ${TITLE_SEARCH_FIELDS} } } } }
      }
    }
  `, { term: q })

  const results = data.mainSearch.edges
    .map(e => e.node.entity)
    .filter(e => e.id)

  return {
    query: q,
    resultCount: results.length,
    results: results.map(t => compact({
      imdbId: t.id,
      title: t.titleText?.text ?? null,
      year: t.releaseYear?.year ?? null,
      type: t.titleType?.text || t.titleType?.id || null,
      genres: (t.genres?.genres ?? []).map((g: any) => g.text),
      rating: t.ratingsSummary?.aggregateRating ?? null,
      voteCount: t.ratingsSummary?.voteCount || null,
      runtime: t.runtime?.seconds ? Math.round(t.runtime.seconds / 60) : null,
      certificate: t.certificate?.rating ?? null,
    })),
  }
}

async function getTitleDetail(_page: Page | null, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  const data = await gql<{ title: Record<string, any> }>(`
    query TitleDetail($id: ID!) {
      title(id: $id) { ${TITLE_DETAIL_FIELDS} }
    }
  `, { id: imdbId })

  const t = data.title
  if (!t) throw new Error('No title data found')

  const credits = (t.principalCredits ?? []).map((c: any) => ({
    category: c.category?.text ?? null,
    names: (c.credits ?? []).map((cr: any) => ({
      name: cr.name?.nameText?.text ?? null,
      id: cr.name?.id ?? null,
    })),
  }))

  const rd = t.releaseDate
  const releaseDate = rd?.day
    ? `${rd.year}-${String(rd.month).padStart(2, '0')}-${String(rd.day).padStart(2, '0')}`
    : null

  return {
    imdbId: t.id ?? imdbId,
    title: t.titleText?.text ?? null,
    originalTitle: t.originalTitleText?.text ?? null,
    type: t.titleType?.text ?? null,
    year: t.releaseYear?.year ?? null,
    endYear: t.releaseYear?.endYear ?? null,
    rating: t.ratingsSummary?.aggregateRating ?? null,
    voteCount: t.ratingsSummary?.voteCount ?? null,
    runtime: t.runtime?.seconds ? Math.round(t.runtime.seconds / 60) : null,
    runtimeDisplay: t.runtime?.displayableProperty?.value?.plainText ?? null,
    certificate: t.certificate?.rating ?? null,
    genres: (t.genres?.genres ?? []).map((g: any) => g.text),
    plot: t.plot?.plotText?.plainText ?? null,
    image: t.primaryImage?.url ?? null,
    releaseDate,
    keywords: t.keywords?.edges?.map((e: any) => e.node?.text) ?? [],
    credits,
    reviewCount: t.reviews?.total ?? null,
    wins: t.prestigiousAwardSummary?.wins ?? null,
    nominations: t.nominations?.total ?? null,
  }
}

async function getRatings(
  page: Page | null,
  params: Readonly<Record<string, unknown>>,
  helpers: AdapterHelpers,
): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  // GraphQL: aggregate rating + vote count (works without browser)
  const data = await gql<{ title: Record<string, any> }>(`
    query TitleRatings($id: ID!) {
      title(id: $id) {
        id
        titleText { text }
        ratingsSummary { aggregateRating voteCount }
      }
    }
  `, { id: imdbId })

  const t = data.title
  if (!t) throw new Error('No title data found')

  // Histogram + LD+JSON from the title page (not the separate /ratings/ page)
  let histogram: Array<{ rating: number; voteCount: number }> = []
  let ldJson: { ratingValue?: unknown; ratingCount?: unknown; bestRating?: unknown; worstRating?: unknown } | null = null
  if (page) {
    try {
      await page.goto(`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`, {
        waitUntil: 'load',
        timeout: 20_000,
      })
      // Wait for page to fully settle — IMDB's React hydration can trigger
      // client-side navigations that destroy the execution context.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

      const hist = await helpers.ssrExtract(
        page,
        '__NEXT_DATA__',
        'props.pageProps.mainColumnData.aggregateRatingsBreakdown.histogram.histogramValues',
      ).catch(() => null)
      if (Array.isArray(hist)) {
        histogram = hist.map((h: any) => ({ rating: h.rating, voteCount: h.voteCount }))
      }

      const ldBlocks = await helpers.jsonLdExtract(page).catch(() => [] as unknown[])
      for (const block of ldBlocks) {
        const agg = (block as { aggregateRating?: Record<string, unknown> }).aggregateRating
        if (agg) {
          ldJson = {
            ratingValue: agg.ratingValue,
            ratingCount: agg.ratingCount,
            bestRating: agg.bestRating,
            worstRating: agg.worstRating,
          }
          break
        }
      }
    } catch {
      // Title page unavailable — return GraphQL data without histogram
    }
  }

  return {
    imdbId: t.id ?? imdbId,
    title: t.titleText?.text ?? null,
    aggregateRating: ldJson?.ratingValue ?? t.ratingsSummary?.aggregateRating ?? null,
    voteCount: ldJson?.ratingCount ?? t.ratingsSummary?.voteCount ?? null,
    histogram,
  }
}

async function getCast(_page: Page | null, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  const data = await gql<{ title: Record<string, any> }>(`
    query TitleCast($id: ID!) {
      title(id: $id) {
        id
        titleText { text }
        principalCredits {
          category { text }
          credits(limit: 10) {
            name { id nameText { text } }
          }
        }
        directors: principalCredits {
          category { text }
          credits(limit: 10) {
            name { id nameText { text } }
          }
        }
      }
    }
  `, { id: imdbId })

  const t = data.title
  if (!t) throw new Error('No title data found')

  const credits = (t.principalCredits ?? []).map((c: any) => ({
    category: c.category?.text ?? null,
    names: (c.credits ?? []).map((cr: any) => ({
      name: cr.name?.nameText?.text ?? null,
      id: cr.name?.id ?? null,
    })),
  }))

  // Extract actors, directors, creators from principalCredits
  const findCategory = (cats: any[], ...names: string[]) =>
    cats.find((c: any) => names.some(n => c.category?.text?.toLowerCase().includes(n.toLowerCase())))

  const creditsRaw = t.principalCredits ?? []
  const actorCredits = findCategory(creditsRaw, 'star', 'actor', 'cast')
  const directorCredits = findCategory(creditsRaw, 'director')
  const writerCredits = findCategory(creditsRaw, 'writer', 'creator')

  const toPersonList = (entry: any) =>
    (entry?.credits ?? []).map((cr: any) => ({
      name: cr.name?.nameText?.text ?? null,
      url: cr.name?.id ? `/name/${cr.name.id}/` : null,
    }))

  return {
    imdbId: t.id ?? imdbId,
    title: t.titleText?.text ?? null,
    credits,
    actors: toPersonList(actorCredits),
    directors: toPersonList(directorCredits),
    creators: toPersonList(writerCredits),
  }
}

type OpHandler = (page: Page | null, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchTitles,
  getTitleDetail,
  getRatings,
  getCast,
}

const adapter: CustomRunner = {
  name: 'imdb',
  description: 'IMDb GraphQL API — search titles, detail, ratings, and cast via api.graphql.imdb.com',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default adapter
