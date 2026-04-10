import type { Page } from 'patchright'
import type { PageFetchOptions, PageFetchResult } from '../../../lib/adapter-helpers.js'

/**
 * Instagram L2 adapter — composes REST v1 calls for username-based operations.
 *
 * getUserPosts resolves username → user ID via web_profile_info, then fetches
 * the user feed. This avoids requiring callers to chain two operations manually.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type PageFetchFn = (page: Page, options: PageFetchOptions) => Promise<PageFetchResult>

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'x-requested-with': 'XMLHttpRequest',
}

async function fetchJson(pageFetch: PageFetchFn, page: Page, url: string, errors: Errors): Promise<unknown> {
  const result = await pageFetch(page, {
    url,
    method: 'GET',
    headers: IG_HEADERS,
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) {
    throw errors.fatal(`Instagram returned ${result.status} — login required`)
  }
  if (result.status >= 400) {
    throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal('Response is not valid JSON')
  }
}

async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  return cookies.find((c) => c.name === 'csrftoken')?.value || ''
}

async function postJson(
  pageFetch: PageFetchFn,
  page: Page,
  url: string,
  body: string,
  errors: Errors,
): Promise<unknown> {
  const csrf = await getCsrfToken(page)
  const headers: Record<string, string> = {
    ...IG_HEADERS,
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (csrf) headers['x-csrftoken'] = csrf

  const result = await pageFetch(page, {
    url,
    method: 'POST',
    headers,
    body,
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) {
    throw errors.fatal(`Instagram returned ${result.status} — login required`)
  }
  if (result.status >= 400) {
    throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal('Response is not valid JSON')
  }
}

async function getUserPosts(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')
  const count = Number(params.count) || 12
  const maxId = params.max_id ? String(params.max_id) : ''

  // Step 1: resolve username → user ID
  const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  const profile = (await fetchJson(pageFetch, page, profileUrl, errors)) as Record<string, unknown>
  const user = (profile?.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined
  if (!user?.id) throw errors.fatal(`User "${username}" not found`)

  // Step 2: fetch feed by user ID
  let feedUrl = `https://www.instagram.com/api/v1/feed/user/${user.id}/?count=${count}`
  if (maxId) feedUrl += `&max_id=${encodeURIComponent(maxId)}`
  const feed = (await fetchJson(pageFetch, page, feedUrl, errors)) as Record<string, unknown>

  return {
    user: { id: user.id, username: user.username, full_name: user.full_name },
    num_results: feed.num_results,
    more_available: feed.more_available,
    next_max_id: feed.next_max_id,
    items: feed.items,
  }
}

async function muteUser(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const userId = String(params.id || '')
  if (!userId) throw errors.missingParam('id')

  return postJson(
    pageFetch,
    page,
    'https://www.instagram.com/api/v1/friendships/mute_posts_or_story_from_follow/',
    `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    errors,
  )
}

async function unmuteUser(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const userId = String(params.id || '')
  if (!userId) throw errors.missingParam('id')

  return postJson(
    pageFetch,
    page,
    'https://www.instagram.com/api/v1/friendships/unmute_posts_or_story_from_follow/',
    `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    errors,
  )
}

async function getReels(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const userId = String(params.id || '')
  if (!userId) throw errors.missingParam('id')
  const count = Number(params.count) || 12
  const maxId = params.max_id ? String(params.max_id) : ''

  let body = `target_user_id=${userId}&page_size=${count}`
  if (maxId) body += `&max_id=${encodeURIComponent(maxId)}`

  return postJson(
    pageFetch,
    page,
    'https://www.instagram.com/api/v1/clips/user/',
    body,
    errors,
  )
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, helpers: { errors: Errors; pageFetch: PageFetchFn }) => Promise<unknown>
> = {
  getUserPosts,
  muteUser,
  unmuteUser,
  getReels,
}

const adapter = {
  name: 'instagram-api',
  description: 'Instagram — username-based post retrieval via REST v1 composition',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('instagram.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies()
    return cookies.some((c) => c.name === 'sessionid' && c.value.length > 0)
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: Errors; pageFetch: PageFetchFn },
  ): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
