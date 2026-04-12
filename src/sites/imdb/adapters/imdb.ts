import type { Page } from 'patchright'

import { nodeFetch } from '../../../lib/adapter-helpers.js'

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

// ── Operations ──────────────────────────────────────

async function searchTitles(_page: Page | null, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw new Error('q parameter is required')

  const data = await gql<{ mainSearch: { edges: Array<{ node: { entity: Record<string, any> } }> } }>(`
    query SearchTitles($term: String!) {
      mainSearch(first: 20, options: { searchTerm: $term, type: TITLE }) {
        edges { node { entity { ... on Title { ${TITLE_CORE_FIELDS} } } } }
      }
    }
  `, { term: q })

  const results = data.mainSearch.edges
    .map(e => e.node.entity)
    .filter(e => e.id) // filter out non-title entities

  return {
    query: q,
    resultCount: results.length,
    results: results.map(t => ({
      imdbId: t.id,
      title: t.titleText?.text ?? null,
      year: t.releaseYear?.year ?? null,
      type: t.titleType?.text || t.titleType?.id || null,
      genres: (t.genres?.genres ?? []).map((g: any) => g.text),
      plot: t.plot?.plotText?.plainText ?? null,
      rating: t.ratingsSummary?.aggregateRating ?? null,
      voteCount: t.ratingsSummary?.voteCount ?? null,
      runtime: t.runtime?.seconds ? Math.round(t.runtime.seconds / 60) : null,
      certificate: t.certificate?.rating ?? null,
      image: t.primaryImage?.url ?? null,
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

async function getRatings(page: Page | null, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  // GraphQL: aggregate rating + vote count
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

  // Histogram: only available from __NEXT_DATA__ on the ratings page (requires browser)
  let histogram: Array<{ rating: number; voteCount: number }> = []
  if (page) {
    try {
      await page.goto(`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/ratings/`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
    await page.waitForSelector('#__NEXT_DATA__', { timeout: 8_000 }).catch(() => {})
    const hist = await page.evaluate(() => {
      const el = document.querySelector('#__NEXT_DATA__')
      if (!el?.textContent) return null
      try {
        const nd = JSON.parse(el.textContent)
        return nd.props?.pageProps?.contentData?.histogramData?.histogramValues ?? null
      } catch { return null }
    })
    if (Array.isArray(hist)) {
      histogram = hist.map((h: any) => ({ rating: h.rating, voteCount: h.voteCount }))
    }
  } catch {
    // Histogram unavailable — return GraphQL data without it
  }
  }

  return {
    imdbId: t.id ?? imdbId,
    title: t.titleText?.text ?? null,
    aggregateRating: t.ratingsSummary?.aggregateRating ?? null,
    voteCount: t.ratingsSummary?.voteCount ?? null,
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

const OPERATIONS: Record<string, (page: Page | null, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchTitles,
  getTitleDetail,
  getRatings,
  getCast,
}

const adapter = {
  name: 'imdb',
  description: 'IMDb GraphQL API — search titles, detail, ratings, and cast via api.graphql.imdb.com',

  async init(page: Page | null): Promise<boolean> {
    if (!page) return true
    const url = page.url()
    return url.includes('imdb.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // All operations are public read-only
  },

  async execute(
    page: Page | null,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: { unknownOp(op: string): Error } },
  ): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params)
  },
}

export default adapter
