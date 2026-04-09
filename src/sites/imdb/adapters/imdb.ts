import type { Page } from 'patchright'

const IMDB_ORIGIN = 'https://www.imdb.com'

async function navigateAndExtract(page: Page, url: string): Promise<Record<string, unknown>> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  } catch {
    // Navigation may time out on slow IMDB pages — continue if DOM is available
  }
  // Wait for __NEXT_DATA__ to appear (SSR-rendered script tag)
  try {
    await page.waitForSelector('#__NEXT_DATA__', { timeout: 10_000 })
  } catch {
    // fall through — evaluate will check
  }
  const nd = await page.evaluate(() => {
    const el = document.querySelector('#__NEXT_DATA__')
    if (!el?.textContent) return null
    try {
      return JSON.parse(el.textContent)
    } catch {
      return null
    }
  })
  if (!nd) throw new Error('Failed to extract page data')
  return nd as Record<string, unknown>
}

async function searchTitles(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw new Error('q parameter is required')

  const nd = await navigateAndExtract(page, `${IMDB_ORIGIN}/find/?q=${encodeURIComponent(q)}&s=tt`)
  const pp = (nd as any).props?.pageProps
  const results = pp?.titleResults?.results ?? []

  return {
    query: q,
    resultCount: results.length,
    results: results.map((r: any) => {
      const item = r.listItem ?? {}
      return {
        imdbId: r.index ?? item.titleId ?? null,
        title: item.titleText ?? item.originalTitleText ?? null,
        year: item.releaseYear ?? null,
        type: item.titleType?.text || item.titleType?.id || null,
        genres: item.genres ?? [],
        plot: item.plot ?? null,
        rating: item.ratingSummary?.aggregateRating ?? null,
        voteCount: item.ratingSummary?.voteCount ?? null,
        runtime: item.runtime ? Math.round(item.runtime / 60) : null,
        certificate: item.certificate ?? null,
        image: item.primaryImage?.url ?? null,
      }
    }),
  }
}

async function getTitleDetail(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  const nd = await navigateAndExtract(page, `${IMDB_ORIGIN}/title/${encodeURIComponent(imdbId)}/`)
  const pp = (nd as any).props?.pageProps
  const atf = pp?.aboveTheFoldData
  const mc = pp?.mainColumnData
  if (!atf) throw new Error('No title data found')

  const credits = (atf.principalCreditsV2 ?? []).map((c: any) => ({
    category: c.grouping?.text ?? c.category?.text ?? null,
    names: (c.credits ?? []).map((cr: any) => ({
      name: cr.name?.nameText?.text ?? null,
      id: cr.name?.id ?? null,
    })),
  }))

  return {
    imdbId: atf.id ?? imdbId,
    title: atf.titleText?.text ?? null,
    originalTitle: atf.originalTitleText?.text ?? null,
    type: atf.titleType?.text ?? null,
    year: atf.releaseYear?.year ?? null,
    endYear: atf.releaseYear?.endYear ?? null,
    rating: atf.ratingsSummary?.aggregateRating ?? null,
    voteCount: atf.ratingsSummary?.voteCount ?? null,
    runtime: atf.runtime?.seconds ? Math.round(atf.runtime.seconds / 60) : null,
    runtimeDisplay: atf.runtime?.displayableProperty?.value?.plainText ?? null,
    certificate: atf.certificate?.rating ?? null,
    genres: (atf.genres?.genres ?? []).map((g: any) => g.text),
    plot: atf.plot?.plotText?.plainText ?? null,
    image: atf.primaryImage?.url ?? null,
    releaseDate: atf.releaseDate?.day
      ? `${atf.releaseDate.year}-${String(atf.releaseDate.month).padStart(2, '0')}-${String(atf.releaseDate.day).padStart(2, '0')}`
      : null,
    keywords: atf.keywords?.edges?.map((e: any) => e.node?.text) ?? [],
    credits,
    reviewCount: atf.reviews?.total ?? null,
    wins: mc?.wins?.total ?? null,
    nominations: mc?.nominationsExcludeWins?.total ?? null,
  }
}

async function getRatings(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  const nd = await navigateAndExtract(page, `${IMDB_ORIGIN}/title/${encodeURIComponent(imdbId)}/ratings/`)
  const pp = (nd as any).props?.pageProps
  const cd = pp?.contentData
  if (!cd) throw new Error('No ratings data found')

  const entity = cd.entityMetadata ?? {}
  const histogram = cd.histogramData?.histogramValues ?? []

  return {
    imdbId: entity.id ?? imdbId,
    title: entity.titleText?.text ?? null,
    aggregateRating: entity.ratingsSummary?.aggregateRating ?? null,
    voteCount: entity.ratingsSummary?.voteCount ?? null,
    histogram: histogram.map((h: any) => ({
      rating: h.rating,
      voteCount: h.voteCount,
    })),
  }
}

async function getCast(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const imdbId = String(params.imdbId ?? '')
  if (!imdbId) throw new Error('imdbId parameter is required')

  const nd = await navigateAndExtract(page, `${IMDB_ORIGIN}/title/${encodeURIComponent(imdbId)}/`)
  const pp = (nd as any).props?.pageProps
  const atf = pp?.aboveTheFoldData

  const credits = (atf?.principalCreditsV2 ?? []).map((c: any) => ({
    category: c.grouping?.text ?? c.category?.text ?? null,
    names: (c.credits ?? []).map((cr: any) => ({
      name: cr.name?.nameText?.text ?? null,
      id: cr.name?.id ?? null,
    })),
  }))

  // LD+JSON has actor/director data too
  const ldJson = await page.evaluate(() => {
    const el = document.querySelector('script[type="application/ld+json"]')
    if (!el?.textContent) return null
    try {
      return JSON.parse(el.textContent)
    } catch {
      return null
    }
  })

  const actors = (ldJson?.actor ?? []).map((a: any) => ({
    name: a.name ?? null,
    url: a.url ?? null,
  }))

  const directors = (ldJson?.director ?? []).map((d: any) => ({
    name: d.name ?? null,
    url: d.url ?? null,
  }))

  const creators = (ldJson?.creator ?? []).filter((c: any) => c['@type'] === 'Person').map((c: any) => ({
    name: c.name ?? null,
    url: c.url ?? null,
  }))

  return {
    imdbId: atf?.id ?? imdbId,
    title: atf?.titleText?.text ?? null,
    credits,
    actors,
    directors,
    creators,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchTitles,
  getTitleDetail,
  getRatings,
  getCast,
}

const adapter = {
  name: 'imdb',
  description: 'IMDB SSR extraction — search titles, detail, ratings, and cast via __NEXT_DATA__ and LD+JSON',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('imdb.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // All operations are public read-only
  },

  async execute(
    page: Page,
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
