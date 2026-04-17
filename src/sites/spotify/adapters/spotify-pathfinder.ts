import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * Spotify adapter — GraphQL pathfinder API via browser fetch.
 *
 * Spotify's web player uses api-partner.spotify.com/pathfinder/v2/query
 * with persisted GraphQL queries. Auth is via a bearer token obtained
 * from the web player's runtime. The adapter intercepts a pathfinder
 * request to extract the token, then makes direct fetch calls.
 */

const API_URL = 'https://api-partner.spotify.com/pathfinder/v2/query'

type ErrorHelpers = AdapterHelpers['errors']

interface OperationConfig {
  operationName: string
  hash: string
  defaultVariables?: Record<string, unknown>
}

const GRAPHQL_OPERATIONS: Record<string, OperationConfig> = {
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
  getTrack: {
    operationName: 'getTrack',
    hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
    defaultVariables: {},
  },
  getPlaylist: {
    operationName: 'fetchPlaylistContents',
    hash: '32b05e92e438438408674f95d0fdad8082865dc32acd55bd97f5113b8579092b',
    defaultVariables: { offset: 0, limit: 100, includeEpisodeContentRatingsV2: false },
  },
  getRecommendations: {
    operationName: 'internalLinkRecommenderTrack',
    hash: 'c77098ee9d6ee8ad3eb844938722db60570d040b49f41f5ec6e7be9160a7c86b',
    defaultVariables: { limit: 10 },
  },
}

async function extractToken(page: Page, errors: ErrorHelpers): Promise<{ accessToken: string; clientToken: string }> {
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
    throw errors.apiError('Spotify', 'Could not extract access token from web player')
  }

  return { accessToken, clientToken }
}

async function pathfinderFetch(
  page: Page,
  config: OperationConfig,
  variables: Record<string, unknown>,
  accessToken: string,
  clientToken: string,
  errors: ErrorHelpers,
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
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors && !json.data) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Spotify GraphQL error'
    throw errors.apiError('Spotify', msg)
  }

  return json.data
}

async function userProfileFetch(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  accessToken: string,
  clientToken: string,
  errors: ErrorHelpers,
): Promise<unknown> {
  const userId = params.userId as string
  const limit = (params.limit as number) ?? 10

  const url = `https://spclient.wg.spotify.com/user-profile-view/v3/profile/${encodeURIComponent(userId)}?playlist_limit=${limit}&artist_limit=10&episode_limit=10&market=US`

  const result = await page.evaluate(
    async (args: { url: string; accessToken: string; clientToken: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(args.url, {
          headers: {
            Accept: 'application/json',
            'app-platform': 'WebPlayer',
            authorization: `Bearer ${args.accessToken}`,
            'client-token': args.clientToken,
          },
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { url, accessToken, clientToken },
  )

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  return JSON.parse(result.text)
}

async function spotifyApiFetch(
  page: Page,
  method: string,
  url: string,
  accessToken: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async (args: { method: string; url: string; accessToken: string; body?: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${args.accessToken}`,
          },
          body: args.body,
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { method, url, accessToken, body },
  )
}

type WriteHandler = (
  page: Page,
  params: Readonly<Record<string, unknown>>,
  accessToken: string,
  errors: ErrorHelpers,
) => Promise<unknown>

const WRITE_OPERATIONS: Record<string, WriteHandler> = {
  async likeTrack(page, params, accessToken, errors) {
    const trackId = params.trackId as string
    const result = await spotifyApiFetch(page, 'PUT', 'https://api.spotify.com/v1/me/tracks', accessToken, JSON.stringify({ ids: [trackId] }))
    if (result.status >= 400) throw errors.httpError(result.status)
    return { success: true }
  },
  async unlikeTrack(page, params, accessToken, errors) {
    const trackId = params.trackId as string
    const result = await spotifyApiFetch(page, 'DELETE', 'https://api.spotify.com/v1/me/tracks', accessToken, JSON.stringify({ ids: [trackId] }))
    if (result.status >= 400) throw errors.httpError(result.status)
    return { success: true }
  },
  async addToPlaylist(page, params, accessToken, errors) {
    const playlistId = params.playlistId as string
    const trackUris = params.trackUris as string[]
    const body: Record<string, unknown> = { uris: trackUris }
    if (params.position !== undefined) body.position = params.position
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`
    const result = await spotifyApiFetch(page, 'POST', url, accessToken, JSON.stringify(body))
    if (result.status >= 400) throw errors.httpError(result.status)
    return JSON.parse(result.text)
  },
  async removeFromPlaylist(page, params, accessToken, errors) {
    const playlistId = params.playlistId as string
    const trackUris = params.trackUris as string[]
    const body = { tracks: trackUris.map((uri) => ({ uri })) }
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`
    const result = await spotifyApiFetch(page, 'DELETE', url, accessToken, JSON.stringify(body))
    if (result.status >= 400) throw errors.httpError(result.status)
    return JSON.parse(result.text)
  },
  async createPlaylist(page, params, accessToken, errors) {
    const meResult = await spotifyApiFetch(page, 'GET', 'https://api.spotify.com/v1/me', accessToken)
    if (meResult.status >= 400) throw errors.httpError(meResult.status)
    const userId = (JSON.parse(meResult.text) as { id: string }).id
    const body: Record<string, unknown> = { name: params.name as string }
    if (params.description !== undefined) body.description = params.description
    if (params.public !== undefined) body.public = params.public
    const url = `https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`
    const result = await spotifyApiFetch(page, 'POST', url, accessToken, JSON.stringify(body))
    if (result.status >= 400) throw errors.httpError(result.status)
    return JSON.parse(result.text)
  },
}

// Cached tokens per module
let cachedTokens: { accessToken: string; clientToken: string } | null = null

function isNeedsLogin(err: unknown): boolean {
  return (err as { payload?: { failureClass?: string } }).payload?.failureClass === 'needs_login'
}

const runner: CustomRunner = {
  name: 'spotify-pathfinder',
  description: 'Spotify GraphQL pathfinder API — search, artist, discography, album tracks, playlists, recommendations',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('spotify-pathfinder requires a page (transport: page)')
    const { errors } = helpers

    const graphqlConfig = GRAPHQL_OPERATIONS[operation]
    const writeHandler = WRITE_OPERATIONS[operation]
    if (!graphqlConfig && !writeHandler && operation !== 'getUserPlaylists') {
      throw errors.unknownOp(operation)
    }

    if (!cachedTokens) {
      cachedTokens = await extractToken(page, errors)
    }

    if (writeHandler) {
      try {
        return await writeHandler(page, params, cachedTokens.accessToken, errors)
      } catch (err) {
        if (isNeedsLogin(err)) {
          cachedTokens = await extractToken(page, errors)
          return writeHandler(page, params, cachedTokens.accessToken, errors)
        }
        throw err
      }
    }

    if (operation === 'getUserPlaylists') {
      return userProfileFetch(page, params, cachedTokens.accessToken, cachedTokens.clientToken, errors)
    }

    // GraphQL pathfinder operation
    const config = graphqlConfig!
    const variables = { ...config.defaultVariables, ...params }

    try {
      return await pathfinderFetch(page, config, variables, cachedTokens.accessToken, cachedTokens.clientToken, errors)
    } catch (err) {
      if (isNeedsLogin(err)) {
        cachedTokens = await extractToken(page, errors)
        return pathfinderFetch(page, config, variables, cachedTokens.accessToken, cachedTokens.clientToken, errors)
      }
      throw err
    }
  },
}

export default runner
