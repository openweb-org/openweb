import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * Instagram L2 runner — composes REST v1 calls for username-based operations.
 *
 * getUserPosts resolves username → user ID via web_profile_info, then fetches
 * the user feed. This avoids requiring callers to chain two operations manually.
 */

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'x-requested-with': 'XMLHttpRequest',
}

const AUTH_EXPIRED_STATUSES = new Set([
  'login_required',
  'checkpoint_required',
  'consent_required',
])

type Errors = AdapterHelpers['errors']

function guardAuthExpired(data: unknown, errors: Errors): unknown {
  if (data == null) throw errors.needsLogin()
  if (typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  if (typeof obj.status === 'string' && AUTH_EXPIRED_STATUSES.has(obj.status)) {
    throw errors.needsLogin()
  }
  if (typeof obj.message === 'string' && AUTH_EXPIRED_STATUSES.has(obj.message)) {
    throw errors.needsLogin()
  }
  if ('data' in obj && obj.data == null && Object.keys(obj).length <= 2) {
    throw errors.needsLogin()
  }
  if (obj.require_login === true) {
    throw errors.needsLogin()
  }
  return data
}

async function fetchJson(
  helpers: AdapterHelpers,
  page: Page,
  url: string,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const result = await pageFetch(page, {
    url,
    method: 'GET',
    headers: IG_HEADERS,
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  let data: unknown
  try { data = JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
  return guardAuthExpired(data, errors)
}

async function getCsrfToken(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? '')
  } catch {
    const cookies = await page.context().cookies()
    return cookies.find((c) => c.name === 'csrftoken')?.value || ''
  }
}

async function postJson(
  helpers: AdapterHelpers,
  page: Page,
  url: string,
  body: string,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const csrf = await getCsrfToken(page)
  const headers: Record<string, string> = {
    ...IG_HEADERS,
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (csrf) headers['x-csrftoken'] = csrf

  const result = await pageFetch(page, { url, method: 'POST', headers, body, credentials: 'include' })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  let data: unknown
  try { data = JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
  return guardAuthExpired(data, errors)
}

async function postFriendship(
  helpers: AdapterHelpers,
  page: Page,
  action: string,
  userId: string,
): Promise<unknown> {
  const url = `https://www.instagram.com/api/v1/friendships/${action}/${userId}/`
  return postJson(helpers, page, url, '')
}

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async getUserPosts(page, params, helpers) {
    const { errors } = helpers
    const username = String(params.username || '')
    if (!username) throw errors.missingParam('username')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? String(params.max_id) : ''

    const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    const profile = (await fetchJson(helpers, page, profileUrl)) as Record<string, unknown>
    const user = (profile?.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined
    if (!user?.id) throw errors.fatal(`User "${username}" not found`)

    let feedUrl = `https://www.instagram.com/api/v1/feed/user/${user.id}/?count=${count}`
    if (maxId) feedUrl += `&max_id=${encodeURIComponent(maxId)}`
    const feed = (await fetchJson(helpers, page, feedUrl)) as Record<string, unknown>

    return {
      user: { id: user.id, username: user.username, full_name: user.full_name },
      num_results: feed.num_results,
      more_available: feed.more_available,
      next_max_id: feed.next_max_id,
      items: feed.items,
    }
  },

  async followUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postFriendship(helpers, page, 'create', userId)
  },

  async unfollowUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postFriendship(helpers, page, 'destroy', userId)
  },

  async muteUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postJson(
      helpers, page,
      'https://www.instagram.com/api/v1/friendships/mute_posts_or_story_from_follow/',
      `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    )
  },

  async unmuteUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postJson(
      helpers, page,
      'https://www.instagram.com/api/v1/friendships/unmute_posts_or_story_from_follow/',
      `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    )
  },

  async getReels(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? String(params.max_id) : ''
    let body = `target_user_id=${userId}&page_size=${count}`
    if (maxId) body += `&max_id=${encodeURIComponent(maxId)}`
    return postJson(helpers, page, 'https://www.instagram.com/api/v1/clips/user/', body)
  },

  async getNotifications(page, _params, helpers) {
    return postJson(helpers, page, 'https://www.instagram.com/api/v1/news/inbox/', '')
  },
}

const runner: CustomRunner = {
  name: 'instagram-api',
  description: 'Instagram — username-based post retrieval via REST v1 composition',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('instagram-api requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
