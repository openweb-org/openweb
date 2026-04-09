import type { Page } from 'patchright'

/**
 * Rotten Tomatoes adapter — extracts movie search results, detail, and
 * Tomatometer scores from DOM elements and LD+JSON.
 *
 * Data sources:
 * - Search: `search-page-media-row` web component attributes + inner links
 * - Detail: LD+JSON (schema.org Movie) + `media-scorecard` web component
 * - Tomatometer: `media-scorecard` slots (critics + audience scores)
 */

/* ---------- searchMovies ---------- */

async function searchMovies(
  page: Page,
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = String(params.query || '')
  if (!query) throw new Error('query is required')

  const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page
    .waitForSelector('search-page-media-row', { timeout: 10_000 })
    .catch(() => {})

  return page.evaluate(() => {
    const rows = document.querySelectorAll(
      'search-page-result[type="movie"] search-page-media-row',
    )
    const movies: unknown[] = []
    for (const row of rows) {
      const link = row.querySelector('a[href*="/m/"]') as HTMLAnchorElement | null
      const img = row.querySelector('img') as HTMLImageElement | null
      movies.push({
        title: img?.alt || link?.textContent?.trim() || null,
        url: link?.href || null,
        slug: link?.href?.match(/\/m\/([^/?]+)/)?.[1] || null,
        year: row.getAttribute('release-year') || null,
        tomatometerScore: row.getAttribute('tomatometer-score') || null,
        tomatometerSentiment: row.getAttribute('tomatometer-sentiment') || null,
        isCertifiedFresh:
          row.getAttribute('tomatometer-is-certified') === 'true',
        cast: row.getAttribute('cast') || null,
        thumbnail: img?.src || null,
      })
    }
    return { count: movies.length, movies }
  })
}

/* ---------- getMovieDetail ---------- */

async function getMovieDetail(
  page: Page,
  params: Record<string, unknown>,
): Promise<unknown> {
  const slug = String(params.slug || '')
  if (!slug) throw new Error('slug is required')

  const url = `https://www.rottentomatoes.com/m/${encodeURIComponent(slug)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page
    .waitForSelector('media-scorecard', { timeout: 10_000 })
    .catch(() => {})

  return page.evaluate(() => {
    // LD+JSON extraction
    const ldEl = document.querySelector('script[type="application/ld+json"]')
    let ld: Record<string, unknown> = {}
    if (ldEl?.textContent) {
      try {
        ld = JSON.parse(ldEl.textContent)
      } catch {}
    }

    // Scores from media-scorecard
    const scorecard = document.querySelector('media-scorecard')
    const criticsScoreEl = scorecard?.querySelector('[slot=critics-score]')
    const audienceScoreEl = scorecard?.querySelector('[slot=audience-score]')
    const criticsIcon = scorecard?.querySelector('score-icon-critics')
    const audienceIcon = scorecard?.querySelector('score-icon-audience')
    const criticsReviewsEl = scorecard?.querySelector(
      'rt-link[href*="/reviews"]',
    )

    // Synopsis
    const synopsisEl = document.querySelector('[data-qa=synopsis-value]')
      || document.querySelector('[data-qa="movie-info-synopsis"]')

    // Cast from LD+JSON
    const actors = Array.isArray(ld.actor)
      ? (ld.actor as Array<Record<string, unknown>>).map((a) => ({
          name: a.name ?? null,
          url: a.sameAs ?? null,
        }))
      : []

    const directors = Array.isArray(ld.director)
      ? (ld.director as Array<Record<string, unknown>>).map((d) => ({
          name: d.name ?? null,
          url: d.sameAs ?? null,
        }))
      : []

    const rating = ld.aggregateRating as Record<string, unknown> | undefined

    return {
      title: (ld.name as string) || document.title.replace(/ \| Rotten Tomatoes$/, '') || null,
      url: (ld.url as string) || window.location.href,
      synopsis:
        synopsisEl?.textContent?.trim()
        || (ld.description as string)
        || null,
      contentRating: (ld.contentRating as string) || null,
      releaseDate: (ld.dateCreated as string) || null,
      genre: Array.isArray(ld.genre) ? ld.genre : [],
      poster: (ld.image as string) || null,
      tomatometerScore: criticsScoreEl?.textContent?.trim() || null,
      tomatometerSentiment: criticsIcon?.getAttribute('sentiment') || null,
      isCertifiedFresh: criticsIcon?.getAttribute('certified') === 'true',
      criticsReviewCount:
        Number(rating?.ratingCount) || Number(criticsReviewsEl?.textContent?.match(/(\d+)/)?.[1]) || null,
      audienceScore: audienceScoreEl?.textContent?.trim() || null,
      audienceSentiment: audienceIcon?.getAttribute('sentiment') || null,
      cast: actors,
      directors,
    }
  })
}

/* ---------- getTomatoMeter ---------- */

async function getTomatoMeter(
  page: Page,
  params: Record<string, unknown>,
): Promise<unknown> {
  const slug = String(params.slug || '')
  if (!slug) throw new Error('slug is required')

  const url = `https://www.rottentomatoes.com/m/${encodeURIComponent(slug)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page
    .waitForSelector('media-scorecard', { timeout: 10_000 })
    .catch(() => {})

  return page.evaluate(() => {
    const scorecard = document.querySelector('media-scorecard')
    const criticsScoreEl = scorecard?.querySelector('[slot=critics-score]')
    const criticsTypeEl = scorecard?.querySelector('[slot=critics-score-type]')
    const criticsIcon = scorecard?.querySelector('score-icon-critics')
    const criticsReviewsEl = scorecard?.querySelector(
      'rt-link[href*="/reviews"]',
    )

    const audienceScoreEl = scorecard?.querySelector('[slot=audience-score]')
    const audienceTypeEl = scorecard?.querySelector('[slot=audience-score-type]')
    const audienceIcon = scorecard?.querySelector('score-icon-audience')

    // LD+JSON for aggregate rating
    const ldEl = document.querySelector('script[type="application/ld+json"]')
    let rating: Record<string, unknown> = {}
    if (ldEl?.textContent) {
      try {
        const ld = JSON.parse(ldEl.textContent)
        rating = (ld.aggregateRating as Record<string, unknown>) || {}
      } catch {}
    }

    return {
      title:
        document.title.replace(/ \| Rotten Tomatoes$/, '') || null,
      url: window.location.href,
      tomatometer: {
        score: criticsScoreEl?.textContent?.trim() || null,
        label: criticsTypeEl?.textContent?.trim() || null,
        sentiment: criticsIcon?.getAttribute('sentiment') || null,
        isCertifiedFresh: criticsIcon?.getAttribute('certified') === 'true',
        reviewCount:
          Number(rating.ratingCount)
          || Number(
            criticsReviewsEl?.textContent?.match(/(\d+)/)?.[1],
          )
          || null,
      },
      audienceScore: {
        score: audienceScoreEl?.textContent?.trim() || null,
        label: audienceTypeEl?.textContent?.trim() || null,
        sentiment: audienceIcon?.getAttribute('sentiment') || null,
      },
    }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>) => Promise<unknown>
> = {
  searchMovies,
  getMovieDetail,
  getTomatoMeter,
}

const adapter = {
  name: 'rotten-tomatoes-web',
  description:
    'Rotten Tomatoes — extracts movie data, Tomatometer, and audience scores from DOM and LD+JSON',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('rottentomatoes.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All operations are publicly accessible
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as {
      errors: { unknownOp(op: string): Error; missingParam(p: string): Error }
    }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params })
  },
}

export default adapter
