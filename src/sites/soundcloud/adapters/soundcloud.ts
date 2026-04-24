import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://api-v2.soundcloud.com'
const CLIENT_ID = 'EsIST4DWFy7hEa8mvPoVwdjZ4NTZqmei'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<R> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status === 404) throw errors.apiError('soundcloud', 'Resource not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

const STRIP_KEYS = new Set([
  'kind', 'uri', 'urn',
  'media', 'publisher_metadata', 'track_authorization',
  'monetization_model', 'policy',
  'station_urn', 'station_permalink',
  'secret_token', 'sharing', 'state', 'streamable',
  'license', 'embeddable_by',
  'has_downloads_left', 'downloadable',
  'commentable', 'public',
  'caption', 'display_date',
  'user_id',
  'last_modified',
  'purchase_title', 'purchase_url',
  'release_date', 'label_name',
  'visuals',
  'badges',
  'creator_subscriptions', 'creator_subscription',
  'first_name', 'last_name',
  'groups_count', 'playlist_likes_count',
  'comments_count',
  'date_of_birth',
  'managed_by_feeds', 'set_type', 'published_at',
])

function trimResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(trimResponse)
  if (typeof obj === 'object') {
    const out: R = {}
    for (const [k, v] of Object.entries(obj as R)) {
      if (STRIP_KEYS.has(k)) continue
      out[k] = trimResponse(v)
    }
    return out
  }
  return obj
}

async function searchTracks(params: Params, errors: Errors): Promise<unknown> {
  const q = params.q as string | undefined
  if (!q) throw errors.missingParam('q')
  const limit = (params.limit as number | undefined) ?? 20
  const offset = (params.offset as number | undefined) ?? 0
  const url = `${API}/search/tracks?q=${encodeURIComponent(q)}&client_id=${CLIENT_ID}&limit=${limit}&offset=${offset}`
  const data = await fetchJson(url, errors)
  return trimResponse(data)
}

async function getTrack(params: Params, errors: Errors): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const url = `${API}/tracks/${id}?client_id=${CLIENT_ID}`
  const data = await fetchJson(url, errors)
  return trimResponse(data)
}

async function getUser(params: Params, errors: Errors): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const url = `${API}/users/${id}?client_id=${CLIENT_ID}`
  const data = await fetchJson(url, errors)
  return trimResponse(data)
}

async function getPlaylist(params: Params, errors: Errors): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const url = `${API}/playlists/${id}?client_id=${CLIENT_ID}`
  const data = await fetchJson(url, errors)
  return trimResponse(data)
}

const adapter: CustomRunner = {
  name: 'soundcloud',
  description: 'SoundCloud — response trimming for track/user/playlist data',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    switch (operation) {
      case 'searchTracks': return searchTracks(params, helpers.errors)
      case 'getTrack': return getTrack(params, helpers.errors)
      case 'getUser': return getUser(params, helpers.errors)
      case 'getPlaylist': return getPlaylist(params, helpers.errors)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
