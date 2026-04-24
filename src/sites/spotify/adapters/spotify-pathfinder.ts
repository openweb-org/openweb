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
  getPlaylistMetadata: {
    operationName: 'fetchPlaylistMetadata',
    hash: 'a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4',
    defaultVariables: { offset: 0, limit: 0, enableWatchFeedEntrypoint: false },
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

  // Wait for the page to settle after the search-page navigation so the
  // next page.evaluate doesn't lose its execution context mid-fetch.
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(500)

  return { accessToken, clientToken }
}

const STRIP_KEYS = new Set([
  '__typename', 'extractedColors', 'playability', 'relinkingInformation',
  'associationsV3', 'saved', 'colorRaw', 'visualIdentity',
  'abuseReportingEnabled', 'basePermission', 'currentUserCapabilities',
  'revisionId', 'members', 'following', 'format', 'attributes',
  'report_abuse_disabled', 'has_spotify_name', 'has_spotify_image',
  'color', 'allow_follows', 'show_follows', 'chipOrder',
  'goods', 'headerImage', 'preRelease', 'watchFeedEntrypoint',
  'unmappedMusicVideos', 'relatedMusicVideos', 'pinnedItem',
  'externalLinks', 'visuals', 'relatedContent',
])

function trimResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(trimResponse)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(k)) continue
      out[k] = trimResponse(v)
    }
    return out
  }
  return obj
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

  return trimResponse(json.data)
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

  return trimResponse(JSON.parse(result.text))
}

async function spotifyApiFetch(
  page: Page,
  method: string,
  url: string,
  accessToken: string,
  clientToken: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  // Spotify Web API endpoints (api.spotify.com) refuse traffic that doesn't
  // carry the WebPlayer signature headers — without them the gateway returns
  // 429 even on the very first call. Mirror what the SPA sends.
  return page.evaluate(
    async (args: { method: string; url: string; accessToken: string; clientToken: string; body?: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${args.accessToken}`,
            'client-token': args.clientToken,
            'app-platform': 'WebPlayer',
          },
          body: args.body,
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { method, url, accessToken, clientToken, body },
  )
}

// Pathfinder mutation hashes used by the live web player. Same hash covers
// add+remove because Spotify ships a multi-operation document keyed by
// operationName.
const LIBRARY_MUTATION_HASH = '7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d'

/** Spclient is the WebPlayer's "writable" namespace for playlists/library —
 *  takes the same Bearer + client-token, but the api gateway rejects
 *  api.spotify.com mutations from WebPlayer tokens with 429. Mirrors what
 *  the live UI does when you click Create / Add / Remove in a playlist. */
async function spclientFetch(
  page: Page,
  method: string,
  url: string,
  accessToken: string,
  clientToken: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async (args: { method: string; url: string; accessToken: string; clientToken: string; body?: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${args.accessToken}`,
            'client-token': args.clientToken,
            'app-platform': 'WebPlayer',
          },
          body: args.body,
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { method, url, accessToken, clientToken, body },
  )
}

async function libraryMutation(
  page: Page,
  operationName: 'addToLibrary' | 'removeFromLibrary',
  trackId: string,
  accessToken: string,
  clientToken: string,
  errors: ErrorHelpers,
): Promise<unknown> {
  const body = JSON.stringify({
    variables: { libraryItemUris: [`spotify:track:${trackId}`] },
    operationName,
    extensions: { persistedQuery: { version: 1, sha256Hash: LIBRARY_MUTATION_HASH } },
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
  if (result.status >= 400) throw errors.httpError(result.status)
  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors && !json.data) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Spotify GraphQL error'
    throw errors.apiError('Spotify', msg)
  }
  return { success: true }
}

type WriteHandler = (
  page: Page,
  params: Readonly<Record<string, unknown>>,
  accessToken: string,
  clientToken: string,
  errors: ErrorHelpers,
) => Promise<unknown>

const WRITE_OPERATIONS: Record<string, WriteHandler> = {
  async likeTrack(page, params, accessToken, clientToken, errors) {
    return libraryMutation(page, 'addToLibrary', params.trackId as string, accessToken, clientToken, errors)
  },
  async unlikeTrack(page, params, accessToken, clientToken, errors) {
    return libraryMutation(page, 'removeFromLibrary', params.trackId as string, accessToken, clientToken, errors)
  },
  async addToPlaylist(page, params, accessToken, clientToken, errors) {
    const playlistId = params.playlistId as string
    const trackUris = params.trackUris as string[]
    // spclient changes endpoint — confirmed via direct probe of the SPA's
    // own POST. The extra `attributes` Spotify's UI sends are optional.
    const url = `https://spclient.wg.spotify.com/playlist/v2/playlist/${encodeURIComponent(playlistId)}/changes`
    const addOp: Record<string, unknown> = {
      items: trackUris.map((uri) => ({ uri })),
    }
    if (params.position !== undefined) addOp.fromIndex = params.position
    else addOp.addLast = true
    const body = JSON.stringify({
      deltas: [{
        ops: [{ kind: 'ADD', add: addOp }],
        info: { source: { client: 'WEBPLAYER' } },
      }],
    })
    const result = await spclientFetch(page, 'POST', url, accessToken, clientToken, body)
    if (result.status >= 400) throw errors.httpError(result.status)
    const json = JSON.parse(result.text || '{}') as { revision?: string }
    return { snapshot_id: json.revision ?? '' }
  },
  async removeFromPlaylist(page, params, accessToken, clientToken, errors) {
    const playlistId = params.playlistId as string
    const trackUris = params.trackUris as string[]
    const url = `https://spclient.wg.spotify.com/playlist/v2/playlist/${encodeURIComponent(playlistId)}/changes`
    const body = JSON.stringify({
      deltas: [{
        ops: [{
          kind: 'REM',
          rem: {
            items: trackUris.map((uri) => ({ uri })),
            itemsAsKey: true,
          },
        }],
        info: { source: { client: 'WEBPLAYER' } },
      }],
    })
    const result = await spclientFetch(page, 'POST', url, accessToken, clientToken, body)
    if (result.status >= 400) throw errors.httpError(result.status)
    const json = JSON.parse(result.text || '{}') as { revision?: string }
    return { snapshot_id: json.revision ?? '' }
  },
  async createPlaylist(page, params, accessToken, clientToken, errors) {
    // Confirmed via CDP capture — Web Player's "+" → New playlist hits
    // POST spclient.wg.spotify.com/playlist/v2/playlist with an UPDATE_LIST_ATTRIBUTES op.
    const name = params.name as string
    const url = 'https://spclient.wg.spotify.com/playlist/v2/playlist'
    const body = JSON.stringify({
      ops: [{
        kind: 'UPDATE_LIST_ATTRIBUTES',
        updateListAttributes: { newAttributes: { values: { name } } },
      }],
    })
    const result = await spclientFetch(page, 'POST', url, accessToken, clientToken, body)
    if (result.status >= 400) throw errors.httpError(result.status)
    const created = JSON.parse(result.text) as { uri?: string; revision?: string }
    if (!created.uri) throw errors.apiError('Spotify', 'createPlaylist returned no uri')
    const playlistId = created.uri.replace('spotify:playlist:', '')

    // Apply description / public if provided — these go through a separate
    // updates call on the new playlist's changes endpoint.
    const extraOps: Array<Record<string, unknown>> = []
    if (params.description !== undefined) {
      extraOps.push({ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { description: params.description as string } } } })
    }
    if (extraOps.length > 0) {
      const updateBody = JSON.stringify({ deltas: [{ ops: extraOps, info: { source: { client: 'WEBPLAYER' } } }] })
      await spclientFetch(page, 'POST', `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}/changes`, accessToken, clientToken, updateBody)
    }

    return {
      id: playlistId,
      uri: created.uri,
      name,
      description: (params.description as string) ?? '',
      public: (params.public as boolean) ?? false,
    }
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
        return await writeHandler(page, params, cachedTokens.accessToken, cachedTokens.clientToken, errors)
      } catch (err) {
        if (isNeedsLogin(err)) {
          cachedTokens = await extractToken(page, errors)
          return writeHandler(page, params, cachedTokens.accessToken, cachedTokens.clientToken, errors)
        }
        throw err
      }
    }

    if (operation === 'getUserPlaylists') {
      return userProfileFetch(page, params, cachedTokens.accessToken, cachedTokens.clientToken, errors)
    }

    // getPlaylist: merge metadata + content from two separate persisted queries
    if (operation === 'getPlaylist') {
      const metaConfig = GRAPHQL_OPERATIONS.getPlaylistMetadata!
      const contentConfig = graphqlConfig!
      const metaVars = { ...metaConfig.defaultVariables, uri: params.uri }
      const contentVars = { ...contentConfig.defaultVariables, ...params }
      const metaData = await pathfinderFetch(page, metaConfig, metaVars, cachedTokens.accessToken, cachedTokens.clientToken, errors) as Record<string, unknown>
      const contentData = await pathfinderFetch(page, contentConfig, contentVars, cachedTokens.accessToken, cachedTokens.clientToken, errors) as Record<string, unknown>
      const metaPlaylist = (metaData.playlistV2 ?? {}) as Record<string, unknown>
      const contentPlaylist = (contentData.playlistV2 ?? {}) as Record<string, unknown>
      return { playlistV2: { ...metaPlaylist, content: contentPlaylist.content } }
    }

    // GraphQL pathfinder operation
    if (!graphqlConfig) throw errors.unknownOp(operation)
    const variables = { ...graphqlConfig.defaultVariables, ...params }

    let result: unknown
    try {
      result = await pathfinderFetch(page, graphqlConfig, variables, cachedTokens.accessToken, cachedTokens.clientToken, errors)
    } catch (err) {
      if (isNeedsLogin(err)) {
        cachedTokens = await extractToken(page, errors)
        result = await pathfinderFetch(page, graphqlConfig, variables, cachedTokens.accessToken, cachedTokens.clientToken, errors)
      } else {
        throw err
      }
    }

    if (operation === 'getTrack') {
      const track = (result as Record<string, unknown>).trackUnion as Record<string, unknown> | undefined
      if (track) {
        for (const key of ['firstArtist', 'otherArtists'] as const) {
          const group = track[key] as { items?: Record<string, unknown>[] } | undefined
          if (group?.items) {
            for (const item of group.items) {
              delete item.discography
            }
          }
        }
      }
    }

    return result
  },
}

export default runner
