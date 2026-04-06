import type { Page } from 'patchright'
import { OpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'

/**
 * Spotify adapter — GraphQL pathfinder API via browser fetch.
 *
 * Spotify's web player uses api-partner.spotify.com/pathfinder/v2/query
 * with persisted GraphQL queries. Auth is via a bearer token obtained
 * from the web player's runtime. The adapter intercepts a pathfinder
 * request to extract the token, then makes direct fetch calls.
 */

const API_URL = 'https://api-partner.spotify.com/pathfinder/v2/query'

interface OperationConfig {
  operationName: string
  hash: string
  defaultVariables?: Record<string, unknown>
}

const OPERATIONS: Record<string, OperationConfig> = {
  searchMusic: {
    operationName: 'searchDesktop',
    hash: '21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e',
    defaultVariables: {
      offset: 0,
      limit: 10,
      numberOfTopResults: 5,
      includeAudiobooks: true,
      includeArtistHasConcertsField: false,
      includePreReleases: true,
      includeAuthors: false,
      includeEpisodeContentRatingsV2: false,
    },
  },
  getArtist: {
    operationName: 'queryArtistOverview',
    hash: '5b9e64f43843fa3a9b6a98543600299b0a2cbbbccfdcdcef2402eb9c1017ca4c',
    defaultVariables: { locale: '', preReleaseV2: false },
  },
  getArtistDiscography: {
    operationName: 'queryArtistDiscographyAll',
    hash: '5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599',
    defaultVariables: { offset: 0, limit: 20, order: 'DATE_DESC' },
  },
  getAlbumTracks: {
    operationName: 'queryAlbumTracks',
    hash: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
    defaultVariables: { offset: 0, limit: 300 },
  },
}

async function extractToken(page: Page): Promise<{ accessToken: string; clientToken: string }> {
  // Use Playwright request interception — more reliable than monkey-patching fetch
  const requestPromise = page.waitForRequest(
    (req) => req.url().includes('pathfinder') && !!req.headers().authorization,
    { timeout: 15_000 },
  )

  // Navigate to search page to trigger a pathfinder request
  page.goto('https://open.spotify.com/search', { waitUntil: 'domcontentloaded' }).catch(() => {})

  const request = await requestPromise
  const headers = request.headers()
  const accessToken = (headers.authorization ?? '').replace('Bearer ', '')
  const clientToken = headers['client-token'] ?? ''

  if (!accessToken) {
    throw OpenWebError.apiError('Spotify', 'Could not extract access token from web player')
  }

  return { accessToken, clientToken }
}

async function pathfinderFetch(
  page: Page,
  config: OperationConfig,
  variables: Record<string, unknown>,
  accessToken: string,
  clientToken: string,
): Promise<unknown> {
  const body = JSON.stringify({
    variables,
    operationName: config.operationName,
    extensions: {
      persistedQuery: { version: 1, sha256Hash: config.hash },
    },
  })

  const result = await page.evaluate(
    async (args: { url: string; body: string; accessToken: string; clientToken: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(args.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'app-platform': 'WebPlayer',
            authorization: `Bearer ${args.accessToken}`,
            'client-token': args.clientToken,
          },
          body: args.body,
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { url: API_URL, body, accessToken, clientToken },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors && !json.data) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Spotify GraphQL error'
    throw OpenWebError.apiError('Spotify', msg)
  }

  return json.data
}

// Cached tokens per page
let cachedTokens: { accessToken: string; clientToken: string } | null = null

const adapter: CodeAdapter = {
  name: 'spotify-pathfinder',
  description: 'Spotify GraphQL pathfinder API — search, artist, discography, album tracks',

  async init(page: Page): Promise<boolean> {
    // Check if we're on open.spotify.com
    const url = page.url()
    return url.includes('open.spotify.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    // Spotify works for both anonymous and logged-in users
    // Anonymous gets limited results but search still works
    const url = page.url()
    return url.includes('open.spotify.com')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const config = OPERATIONS[operation]
    if (!config) {
      throw OpenWebError.apiError('Spotify', `Unknown operation: ${operation}`)
    }

    // Extract tokens if not cached
    if (!cachedTokens) {
      cachedTokens = await extractToken(page)
    }

    // Merge default variables with user params
    const variables = { ...config.defaultVariables, ...params }

    try {
      return await pathfinderFetch(page, config, variables, cachedTokens.accessToken, cachedTokens.clientToken)
    } catch (err) {
      // If auth expired, retry with fresh token
      if (err instanceof OpenWebError && err.payload.failureClass === 'needs_login') {
        cachedTokens = await extractToken(page)
        return pathfinderFetch(page, config, variables, cachedTokens.accessToken, cachedTokens.clientToken)
      }
      throw err
    }
  },
}

export default adapter
