import type { Page } from 'patchright'

import { nodeFetch } from '../../../lib/adapter-helpers.js'

/**
 * Rotten Tomatoes adapter — node-native HTML parsing.
 *
 * All data is server-rendered (SSR) and extractable via plain HTTP fetch.
 * No browser needed: search results live in `search-page-media-row` element
 * attributes, detail pages embed LD+JSON (schema.org Movie) + `media-scorecard`
 * web component slots with score data in the HTML source.
 */

async function fetchHtml(url: string): Promise<string> {
  const result = await nodeFetch({
    url,
    headers: { Accept: 'text/html' },
  })
  if (result.status >= 400) throw new Error(`HTTP ${result.status} fetching ${url}`)
  return result.text
}

/** Extract an HTML attribute value from an element string. */
function attr(el: string, name: string): string | null {
  const m = el.match(new RegExp(`${name}="([^"]*)"`, 's'))
  return m ? m[1] : null
}

/** Decode common HTML entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/* ---------- searchMovies ---------- */

async function searchMovies(
  _page: Page | null,
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = String(params.query || '')
  if (!query) throw new Error('query is required')

  const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`
  const html = await fetchHtml(url)

  // Isolate the movie results section
  const movieSectionMatch = html.match(
    /<search-page-result[^>]*type="movie"[^>]*>([\s\S]*?)<\/search-page-result>/,
  )
  const section = movieSectionMatch?.[1] ?? ''

  // Extract each search-page-media-row element
  const rowRegex = /<search-page-media-row\s+([\s\S]*?)>([\s\S]*?)<\/search-page-media-row>/g
  const movies: unknown[] = []
  let m: RegExpExecArray | null
  while ((m = rowRegex.exec(section)) !== null) {
    const attrs = m[1]
    const inner = m[2]

    // Title from img alt or link text
    const imgAlt = inner.match(/<img[^>]*alt="([^"]*)"/)
    const linkText = inner.match(/<a[^>]*href="[^"]*\/m\/[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const title = imgAlt?.[1] || linkText?.[1]?.replace(/<[^>]*>/g, '').trim() || null

    // URL — the href may be absolute or relative
    const hrefMatch = inner.match(/href="([^"]*\/m\/[^"]*)"/)
    let movieUrl: string | null = null
    let slug: string | null = null
    if (hrefMatch) {
      const href = hrefMatch[1]
      movieUrl = href.startsWith('http') ? href : `https://www.rottentomatoes.com${href}`
      slug = href.match(/\/m\/([^/?]+)/)?.[1] || null
    }

    // Thumbnail
    const imgSrc = inner.match(/<img[^>]*src="([^"]*)"/)

    movies.push({
      title: title ? decodeEntities(title) : null,
      url: movieUrl,
      slug,
      year: attr(attrs, 'release-year') || null,
      tomatometerScore: attr(attrs, 'tomatometer-score') || null,
      tomatometerSentiment: attr(attrs, 'tomatometer-sentiment') || null,
      isCertifiedFresh: attr(attrs, 'tomatometer-is-certified') === 'true',
      cast: attr(attrs, 'cast') || null,
      thumbnail: imgSrc?.[1] || null,
    })
  }

  return { count: movies.length, movies }
}

/* ---------- getMovieDetail ---------- */

async function getMovieDetail(
  _page: Page | null,
  params: Record<string, unknown>,
): Promise<unknown> {
  const slug = String(params.slug || '')
  if (!slug) throw new Error('slug is required')

  const url = `https://www.rottentomatoes.com/m/${encodeURIComponent(slug)}`
  const html = await fetchHtml(url)

  // LD+JSON extraction
  const ldMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )
  let ld: Record<string, unknown> = {}
  if (ldMatch) {
    try {
      ld = JSON.parse(ldMatch[1])
    } catch { /* ignore */ }
  }

  // Scores from the first (main) media-scorecard
  const scorecardMatch = html.match(
    /<media-scorecard[\s\S]*?<\/media-scorecard>/,
  )
  const sc = scorecardMatch?.[0] ?? ''

  const criticsScore = sc.match(/slot="critics-score"[^>]*>\s*(\d+%)/)?.[1] ?? null
  const criticsIcon = sc.match(/<score-icon-critics([^>]*)>/)?.[1] ?? ''
  const audienceScore = sc.match(/slot="audience-score"[^>]*>\s*(\d+%)/)?.[1] ?? null

  // Review count from rt-link with /reviews path
  const reviewLink = sc.match(
    /href="[^"]*\/reviews[^"]*"[^>]*>\s*([\d,]+)\s*Reviews/,
  )
  const reviewCount = reviewLink
    ? Number(reviewLink[1].replace(/,/g, ''))
    : null

  // Synopsis
  const synopsisMatch = html.match(
    /data-qa="synopsis-value"[^>]*>([\s\S]*?)<\//,
  )
  const synopsis = synopsisMatch
    ? decodeEntities(synopsisMatch[1].trim())
    : (ld.description as string) || null

  // Cast from LD+JSON
  const actors = Array.isArray(ld.actor)
    ? (ld.actor as Array<Record<string, unknown>>).map((a) => ({
        name: (a.name as string) ?? null,
        url: (a.sameAs as string) ?? null,
      }))
    : []

  const directors = Array.isArray(ld.director)
    ? (ld.director as Array<Record<string, unknown>>).map((d) => ({
        name: (d.name as string) ?? null,
        url: (d.sameAs as string) ?? null,
      }))
    : []

  const rating = ld.aggregateRating as Record<string, unknown> | undefined

  // Certified fresh: boolean attribute (presence = true)
  const isCertified =
    /\bcertified\b/.test(criticsIcon) &&
    !criticsIcon.includes('certified="false"')

  return {
    title: (ld.name as string) || null,
    url: (ld.url as string) || url,
    synopsis,
    contentRating: (ld.contentRating as string) || null,
    releaseDate: (ld.dateCreated as string) || null,
    genre: Array.isArray(ld.genre) ? ld.genre : [],
    poster: (ld.image as string) || null,
    tomatometerScore: criticsScore,
    tomatometerSentiment:
      attr(criticsIcon, 'sentiment')?.toUpperCase() || null,
    isCertifiedFresh: isCertified,
    criticsReviewCount: Number(rating?.ratingCount) || reviewCount,
    audienceScore,
    audienceSentiment:
      attr(sc.match(/<score-icon-audience([^>]*)>/)?.[1] ?? '', 'sentiment')?.toUpperCase() || null,
    cast: actors,
    directors,
  }
}

/* ---------- getTomatoMeter ---------- */

async function getTomatoMeter(
  _page: Page | null,
  params: Record<string, unknown>,
): Promise<unknown> {
  const slug = String(params.slug || '')
  if (!slug) throw new Error('slug is required')

  const url = `https://www.rottentomatoes.com/m/${encodeURIComponent(slug)}`
  const html = await fetchHtml(url)

  // Title from page title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/)
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/ \| Rotten Tomatoes$/, ''))
    : null

  // Main scorecard
  const scorecardMatch = html.match(
    /<media-scorecard[\s\S]*?<\/media-scorecard>/,
  )
  const sc = scorecardMatch?.[0] ?? ''

  const criticsScore = sc.match(/slot="critics-score"[^>]*>\s*(\d+%)/)?.[1] ?? null
  const criticsType = sc.match(/slot="critics-score-type"[^>]*>([^<]+)/)?.[1]?.trim() ?? null
  const criticsIcon = sc.match(/<score-icon-critics([^>]*)>/)?.[1] ?? ''
  const isCertified =
    /\bcertified\b/.test(criticsIcon) &&
    !criticsIcon.includes('certified="false"')

  const audienceScore = sc.match(/slot="audience-score"[^>]*>\s*(\d+%)/)?.[1] ?? null
  const audienceType = sc.match(/slot="audience-score-type"[^>]*>([^<]+)/)?.[1]?.trim() ?? null
  const audienceIcon = sc.match(/<score-icon-audience([^>]*)>/)?.[1] ?? ''

  // Review count from LD+JSON aggregateRating or rt-link
  const ldMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )
  let ratingCount: number | null = null
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1])
      ratingCount = Number(ld.aggregateRating?.ratingCount) || null
    } catch { /* ignore */ }
  }
  if (!ratingCount) {
    const reviewLink = sc.match(
      /href="[^"]*\/reviews[^"]*"[^>]*>\s*([\d,]+)\s*Reviews/,
    )
    ratingCount = reviewLink
      ? Number(reviewLink[1].replace(/,/g, ''))
      : null
  }

  return {
    title,
    url,
    tomatometer: {
      score: criticsScore,
      label: criticsType,
      sentiment: attr(criticsIcon, 'sentiment')?.toUpperCase() || null,
      isCertifiedFresh: isCertified,
      reviewCount: ratingCount,
    },
    audienceScore: {
      score: audienceScore,
      label: audienceType,
      sentiment: attr(audienceIcon, 'sentiment')?.toUpperCase() || null,
    },
  }
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page | null, params: Record<string, unknown>) => Promise<unknown>
> = {
  searchMovies,
  getMovieDetail,
  getTomatoMeter,
}

const adapter = {
  name: 'rotten-tomatoes-web',
  description:
    'Rotten Tomatoes — node-native SSR HTML parsing (LD+JSON + element attributes)',

  async init(_page: Page | null): Promise<boolean> {
    return true // No browser init needed — uses native fetch
  },

  async isAuthenticated(_page: Page | null): Promise<boolean> {
    return true // All operations are publicly accessible
  },

  async execute(
    page: Page | null,
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
