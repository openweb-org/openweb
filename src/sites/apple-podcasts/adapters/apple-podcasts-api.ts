import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Apple Podcasts L3 adapter — amp-api via browser fetch.
 *
 * Apple Podcasts serves data through amp-api.podcasts.apple.com (MusicKit API).
 * Requires a Bearer token obtained from MusicKit.getInstance().developerToken
 * in the browser context. All read operations work without user login.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const AMP_API = 'https://amp-api.podcasts.apple.com'
const CATALOG = `${AMP_API}/v1/catalog/us`

/* ---------- helpers ---------- */

async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const mk = (window as unknown as Record<string, unknown>).MusicKit as
      | { getInstance(): { developerToken: string } }
      | undefined
    return mk?.getInstance()?.developerToken ?? ''
  })
  if (!token) throw OpenWebError.apiError('Apple Podcasts', 'MusicKit developer token not available')
  return token
}

async function ampGet(
  page: Page,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const token = await getToken(page)
  const qs = new URLSearchParams({ platform: 'web', ...params }).toString()
  const url = `${CATALOG}${path}?${qs}`

  const result = await page.evaluate(
    async (args: { url: string; token: string }) => {
      const resp = await fetch(args.url, {
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: 'application/json',
          Origin: 'https://podcasts.apple.com',
        },
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url, token },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  return JSON.parse(result.text)
}

/* ---------- operation handlers ---------- */

async function searchPodcasts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const term = String(params.term ?? params.query ?? '')
  const limit = String(params.limit ?? 25)
  const offset = params.offset ? String(params.offset) : undefined

  const json = (await ampGet(page, '/search', {
    term,
    types: 'podcasts',
    limit,
    ...(offset ? { offset } : {}),
  })) as { results?: { podcasts?: { data?: unknown[]; next?: string } } }

  return {
    term,
    results: json.results?.podcasts?.data ?? [],
    next: json.results?.podcasts?.next ?? null,
  }
}

async function searchEpisodes(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const term = String(params.term ?? params.query ?? '')
  const limit = String(params.limit ?? 25)
  const offset = params.offset ? String(params.offset) : undefined

  const json = (await ampGet(page, '/search', {
    term,
    types: 'podcast-episodes',
    limit,
    ...(offset ? { offset } : {}),
  })) as { results?: { 'podcast-episodes'?: { data?: unknown[]; next?: string } } }

  return {
    term,
    results: json.results?.['podcast-episodes']?.data ?? [],
    next: json.results?.['podcast-episodes']?.next ?? null,
  }
}

async function getPodcastDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const podcastId = String(params.podcastId ?? params.id ?? '')

  const json = (await ampGet(page, `/podcasts/${podcastId}`, {
    extend: 'editorialArtwork,feedUrl',
  })) as { data?: unknown[] }

  return json.data?.[0] ?? null
}

async function getPodcastEpisodes(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const podcastId = String(params.podcastId ?? params.id ?? '')
  const limit = String(params.limit ?? 20)
  const offset = params.offset ? String(params.offset) : undefined

  const json = (await ampGet(page, `/podcasts/${podcastId}/episodes`, {
    limit,
    ...(offset ? { offset } : {}),
  })) as { data?: unknown[]; next?: string }

  return {
    podcastId,
    episodes: json.data ?? [],
    next: json.next ?? null,
  }
}

async function getEpisodeDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const episodeId = String(params.episodeId ?? params.id ?? '')

  const json = (await ampGet(page, `/podcast-episodes/${episodeId}`)) as { data?: unknown[] }

  return json.data?.[0] ?? null
}

async function getPodcastReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const podcastId = String(params.podcastId ?? params.id ?? '')
  const limit = String(params.limit ?? 20)
  const offset = params.offset ? String(params.offset) : undefined

  const json = (await ampGet(page, `/podcasts/${podcastId}/reviews`, {
    limit,
    ...(offset ? { offset } : {}),
  })) as { data?: unknown[]; next?: string }

  return {
    podcastId,
    reviews: json.data ?? [],
    next: json.next ?? null,
  }
}

async function getTopPodcasts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const limit = String(params.limit ?? 50)
  const genre = params.genre ? String(params.genre) : undefined

  const json = (await ampGet(page, '/charts', {
    types: 'podcasts',
    limit,
    ...(genre ? { genre } : {}),
  })) as { results?: { podcasts?: unknown[] } }

  const chart = (json.results?.podcasts as { name?: string; data?: unknown[] }[])?.[0]
  return {
    chartName: chart?.name ?? 'Top Podcasts',
    genre: genre ?? null,
    results: chart?.data ?? [],
  }
}

async function getTopEpisodes(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const limit = String(params.limit ?? 50)
  const genre = params.genre ? String(params.genre) : undefined

  const json = (await ampGet(page, '/charts', {
    types: 'podcast-episodes',
    limit,
    ...(genre ? { genre } : {}),
  })) as { results?: { 'podcast-episodes'?: unknown[] } }

  const chart = (json.results?.['podcast-episodes'] as { name?: string; data?: unknown[] }[])?.[0]
  return {
    chartName: chart?.name ?? 'Top Episodes',
    genre: genre ?? null,
    results: chart?.data ?? [],
  }
}

async function getGenreCharts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const genreId = String(params.genreId ?? params.genre ?? '')
  const limit = String(params.limit ?? 50)

  const json = (await ampGet(page, '/charts', {
    types: 'podcasts',
    genre: genreId,
    limit,
  })) as { results?: { podcasts?: unknown[] } }

  const chart = (json.results?.podcasts as { name?: string; data?: unknown[] }[])?.[0]
  return {
    genreId,
    chartName: chart?.name ?? 'Top Podcasts',
    results: chart?.data ?? [],
  }
}

async function searchAll(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const term = String(params.term ?? params.query ?? '')
  const limit = String(params.limit ?? 10)

  const json = (await ampGet(page, '/search/groups', {
    term,
    types: 'podcasts,podcast-episodes',
    limit,
    extend: 'editorialArtwork,feedUrl',
  })) as { results?: { groups?: unknown[] } }

  return {
    term,
    groups: json.results?.groups ?? [],
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPodcasts,
  searchEpisodes,
  getPodcastDetails,
  getPodcastEpisodes,
  getEpisodeDetails,
  getPodcastReviews,
  getTopPodcasts,
  getTopEpisodes,
  getGenreCharts,
  searchAll,
}

const adapter: CodeAdapter = {
  name: 'apple-podcasts-api',
  description: 'Apple Podcasts amp-api — search, details, episodes, reviews, charts',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('podcasts.apple.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public API — developer token, not user auth
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
