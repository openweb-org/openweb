import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Pinterest L3 adapter — Resource API via browser fetch.
 *
 * Pinterest serves data through REST endpoints at /resource/{Name}/get/.
 * Requests require cookie auth and CSRF token (X-CSRFToken header from
 * csrftoken cookie). All read operations work without login for public data.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const BASE_URL = 'https://www.pinterest.com'

/* ---------- helpers ---------- */

async function resourceGet(
  page: Page,
  resource: string,
  options: Record<string, unknown>,
  sourceUrl = '/',
): Promise<unknown> {
  const data = JSON.stringify({ options, context: {} })
  const url = `${BASE_URL}/resource/${resource}/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(data)}`

  const result = await page.evaluate(
    async (args: { url: string }) => {
      const resp = await fetch(args.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
        },
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as {
    resource_response?: { data?: unknown; error?: unknown }
  }

  if (json.resource_response?.error) {
    throw OpenWebError.apiError('Pinterest', JSON.stringify(json.resource_response.error))
  }

  return json.resource_response?.data
}

async function getCSRFToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies(BASE_URL)
  const token = cookies.find((c) => c.name === 'csrftoken')?.value
  if (!token) throw OpenWebError.authRequired('Pinterest CSRF token not found — login required')
  return token
}

async function resourceCreate(
  page: Page,
  resource: string,
  action: 'create' | 'delete',
  options: Record<string, unknown>,
  sourceUrl = '/',
): Promise<unknown> {
  const csrfToken = await getCSRFToken(page)
  const url = `${BASE_URL}/resource/${resource}/${action}/`

  const result = await page.evaluate(
    async (args: { url: string; options: Record<string, unknown>; sourceUrl: string; csrfToken: string }) => {
      const body = new URLSearchParams()
      body.append('source_url', args.sourceUrl)
      body.append('data', JSON.stringify({ options: args.options, context: {} }))
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*, q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'X-CSRFToken': args.csrfToken,
        },
        credentials: 'include',
        body: body.toString(),
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url, options, sourceUrl, csrfToken },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as {
    resource_response?: { data?: unknown; error?: unknown; status?: string }
  }

  if (json.resource_response?.error) {
    throw OpenWebError.apiError('Pinterest', JSON.stringify(json.resource_response.error))
  }

  return json.resource_response?.data
}

/* ---------- operation handlers ---------- */

async function searchPins(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    query,
    scope: 'pins',
    rs: 'typed',
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(
    page,
    'BaseSearchResource',
    options,
    `/search/pins/?q=${encodeURIComponent(query)}`,
  )

  const resp = data as { results?: unknown[]; bookmark?: string } | null
  return {
    query,
    results: resp?.results ?? [],
    bookmark: resp?.bookmark ?? null,
  }
}

async function searchBoards(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    query,
    scope: 'boards',
    rs: 'typed',
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(
    page,
    'BaseSearchResource',
    options,
    `/search/boards/?q=${encodeURIComponent(query)}`,
  )

  const resp = data as { results?: unknown[]; bookmark?: string } | null
  return {
    query,
    results: resp?.results ?? [],
    bookmark: resp?.bookmark ?? null,
  }
}

async function getPinDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pinId = String(params.pinId ?? params.id ?? '')
  const options = {
    id: pinId,
    field_set_key: 'detailed',
  }

  return resourceGet(page, 'PinResource', options, `/pin/${pinId}/`)
}

async function getBoardDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const boardId = String(params.boardId ?? params.id ?? '')
  const slug = String(params.slug ?? '')

  const options: Record<string, unknown> = boardId
    ? { board_id: boardId, field_set_key: 'detailed' }
    : { slug, field_set_key: 'detailed' }

  return resourceGet(page, 'BoardResource', options, "/")
}

async function getBoardPins(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const boardId = String(params.boardId ?? params.id ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    board_id: boardId,
    field_set_key: 'partner_react_grid_pin',
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(page, 'BoardFeedResource', options, "/")

  const resp = data as unknown[] | null
  return {
    boardId,
    pins: resp ?? [],
  }
}

async function getUserProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const username = String(params.username ?? '')
  const options = {
    username,
    field_set_key: 'profile',
  }

  return resourceGet(page, 'UserResource', options, `/${username}/`)
}

async function getUserBoards(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const username = String(params.username ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    username,
    field_set_key: 'detailed',
    sort: 'last_pinned_to',
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(
    page,
    'BoardsResource',
    options,
    `/${username}/`,
  )

  const resp = data as unknown[] | null
  return {
    username,
    boards: resp ?? [],
  }
}

async function getRelatedPins(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pinId = String(params.pinId ?? params.id ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    pin_id: pinId,
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(page, 'RelatedModulesResource', options, `/pin/${pinId}/`)

  const resp = data as unknown[] | null
  return {
    pinId,
    modules: resp ?? [],
  }
}

async function getTypeahead(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const options = {
    query,
    count: Number(params.count ?? 5),
  }

  return resourceGet(
    page,
    'AdvancedTypeaheadResource',
    options,
    `/search/pins/?q=${encodeURIComponent(query)}`,
  )
}

async function getPinComments(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pinId = String(params.pinId ?? params.id ?? '')
  const bookmark = params.bookmark ? String(params.bookmark) : ''
  const options: Record<string, unknown> = {
    pin_id: pinId,
    page_size: Number(params.pageSize ?? 20),
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  }

  const data = await resourceGet(page, 'UnifiedCommentsResource', options, `/pin/${pinId}/`)

  const resp = data as { comments?: unknown[]; bookmark?: string } | null
  return {
    pinId,
    comments: resp?.comments ?? (Array.isArray(resp) ? resp : []),
    bookmark: resp?.bookmark ?? null,
  }
}

/* ---------- write operations ---------- */

async function savePin(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pinId = String(params.pinId ?? params.id ?? '')
  const boardId = String(params.boardId ?? '')
  if (!pinId) throw OpenWebError.validation('pinId is required')
  if (!boardId) throw OpenWebError.validation('boardId is required')

  const data = await resourceCreate(
    page,
    'RepinResource',
    'create',
    { pin_id: pinId, board_id: boardId, section_id: null, is_buyable_pin: false },
    `/pin/${pinId}/`,
  )

  const pin = data as Record<string, unknown> | null
  return {
    success: true,
    pinId: pin?.id ?? null,
    boardId,
    originalPinId: pinId,
  }
}

async function likePin(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pinId = String(params.pinId ?? params.id ?? '')
  if (!pinId) throw OpenWebError.validation('pinId is required')

  const csrfToken = await getCSRFToken(page)
  const url = `${BASE_URL}/resource/ApiResource/create/`

  const result = await page.evaluate(
    async (args: { url: string; pinId: string; sourceUrl: string; csrfToken: string }) => {
      const body = new URLSearchParams()
      body.append('source_url', args.sourceUrl)
      body.append('data', JSON.stringify({
        options: { url: `/v3/pins/${args.pinId}/react/`, data: {} },
        context: {},
      }))
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*, q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'X-CSRFToken': args.csrfToken,
        },
        credentials: 'include',
        body: body.toString(),
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url, pinId, sourceUrl: `/pin/${pinId}/`, csrfToken },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  return { success: true, pinId }
}

async function followUser(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const userId = String(params.userId ?? params.id ?? '')
  if (!userId) throw OpenWebError.validation('userId is required')
  const username = params.username ? String(params.username) : ''

  const data = await resourceCreate(
    page,
    'UserFollowResource',
    'create',
    { user_id: userId },
    username ? `/${username}/` : '/',
  )

  const user = data as Record<string, unknown> | null
  return {
    success: true,
    userId,
    username: user?.username ?? username,
    fullName: user?.full_name ?? null,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPins,
  searchBoards,
  getPinDetails,
  getBoardDetails,
  getBoardPins,
  getUserProfile,
  getUserBoards,
  getRelatedPins,
  getTypeahead,
  getPinComments,
  savePin,
  likePin,
  followUser,
}

const adapter: CodeAdapter = {
  name: 'pinterest-api',
  description: 'Pinterest Resource API — pins, boards, search, profiles',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('pinterest.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.pinterest.com')
    return cookies.some((c) => c.name === '_auth' || c.name === '_pinterest_sess')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
