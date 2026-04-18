import type { Page } from 'patchright'

import { pageFetch, type PageFetchOptions } from '../../../lib/adapter-helpers.js'
import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Weibo L3 adapter — page-context fetch for /ajax/* endpoints.
 *
 * Why this exists: weibo's anti-CSRF rejects requests whose Origin/Referer
 * doesn't match weibo.com (returns 403 "Forbidden"). The runtime's default
 * browser_fetch executor routes through an about:blank iframe to bypass
 * page-script fetch monkey-patching, but that strips Origin to "null". So
 * for weibo we use the main page's `window.fetch` directly — Origin and
 * Referer become https://weibo.com/, and the request is accepted.
 *
 * Cookies (SUB, SUBP, XSRF-TOKEN, WBPSESS) flow via credentials:'include'.
 * For POST/PUT/DELETE writes the X-XSRF-TOKEN header is built from the
 * XSRF-TOKEN cookie, mirroring the spec-level cookie_to_header CSRF.
 */

const SITE = 'https://weibo.com'

type Errors = {
  missingParam(name: string): Error
  unknownOp(op: string): Error
  needsLogin(): Error
  httpError(status: number): Error
  wrap(error: unknown): Error
}

function buildUrl(path: string, params: Record<string, unknown>): string {
  const url = new URL(path, SITE)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

async function getXsrfToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const xsrf = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('XSRF-TOKEN='))
    return xsrf ? decodeURIComponent(xsrf.split('=')[1] ?? '') : ''
  })
}

async function callJson(page: Page, opts: PageFetchOptions, errors: Errors): Promise<unknown> {
  const result = await pageFetch(page, { ...opts, credentials: 'include' })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status < 200 || result.status >= 300) throw errors.httpError(result.status)
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.httpError(result.status)
  }
}

async function get(page: Page, path: string, params: Record<string, unknown>, errors: Errors) {
  return callJson(page, { url: buildUrl(path, params), method: 'GET' }, errors)
}

async function postForm(page: Page, path: string, body: string, errors: Errors) {
  const token = await getXsrfToken(page)
  return callJson(page, {
    url: `${SITE}${path}`,
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-XSRF-TOKEN': token },
  }, errors)
}

async function postJson(page: Page, path: string, body: unknown, errors: Errors) {
  const token = await getXsrfToken(page)
  return callJson(page, {
    url: `${SITE}${path}`,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token },
  }, errors)
}

function requireParam(p: Record<string, unknown>, name: string, errors: Errors): string {
  const value = String(p[name] ?? '')
  if (!value) throw errors.missingParam(name)
  return value
}

/* ---------- read ops ---------- */

async function getHotSearch(page: Page, _p: Record<string, unknown>, errors: Errors) {
  return get(page, '/ajax/side/hotSearch', {}, errors)
}

async function getHotFeed(page: Page, p: Record<string, unknown>, errors: Errors) {
  return get(page, '/ajax/feed/hottimeline', {
    since_id: p.since_id, refresh: p.refresh ?? 4, group_id: p.group_id,
    containerid: p.containerid, extparam: p.extparam, max_id: p.max_id, count: p.count ?? 10,
  }, errors)
}

async function getFriendsFeed(page: Page, p: Record<string, unknown>, errors: Errors) {
  return get(page, '/ajax/feed/friendstimeline', {
    list_id: p.list_id, refresh: p.refresh ?? 4, since_id: p.since_id, count: p.count ?? 25,
  }, errors)
}

async function getPost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return get(page, '/ajax/statuses/show', {
    id, locale: p.locale ?? 'zh-CN', isGetLongText: p.isGetLongText ?? true,
  }, errors)
}

async function getLongtext(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return get(page, '/ajax/statuses/longtext', { id }, errors)
}

async function listComments(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return get(page, '/ajax/statuses/buildComments', {
    id, is_reload: p.is_reload ?? 1, is_show_bulletin: p.is_show_bulletin ?? 2,
    is_mix: p.is_mix ?? 0, count: p.count ?? 20, flow: p.flow ?? 0,
    max_id: p.max_id, fetch_level: p.fetch_level, locale: p.locale,
  }, errors)
}

async function listReposts(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return get(page, '/ajax/statuses/repostTimeline', {
    id, page: p.page ?? 1, count: p.count ?? 10,
  }, errors)
}

async function getUserProfile(page: Page, p: Record<string, unknown>, errors: Errors) {
  const uid = requireParam(p, 'uid', errors)
  return get(page, '/ajax/profile/info', { uid, scene: p.scene }, errors)
}

async function getUserDetail(page: Page, p: Record<string, unknown>, errors: Errors) {
  const uid = requireParam(p, 'uid', errors)
  return get(page, '/ajax/profile/detail', { uid }, errors)
}

async function getUserStatuses(page: Page, p: Record<string, unknown>, errors: Errors) {
  const uid = requireParam(p, 'uid', errors)
  return get(page, '/ajax/statuses/mymblog', {
    uid, page: p.page ?? 1, feature: p.feature ?? 0, since_id: p.since_id,
  }, errors)
}

/* ---------- write ops ---------- */

async function likePost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return postForm(page, '/ajax/statuses/setLike', `id=${encodeURIComponent(id)}`, errors)
}

async function unlikePost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return postForm(page, '/ajax/statuses/cancelLike', `id=${encodeURIComponent(id)}`, errors)
}

async function repost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  const reason = String(p.reason ?? '转发微博')
  return postJson(page, '/ajax/statuses/repost', { id, reason }, errors)
}

async function followUser(page: Page, p: Record<string, unknown>, errors: Errors) {
  const uid = String(p.friend_uid ?? p.uid ?? '')
  if (!uid) throw errors.missingParam('friend_uid')
  return postForm(page, '/ajax/friendships/create', `friend_uid=${encodeURIComponent(uid)}`, errors)
}

async function unfollowUser(page: Page, p: Record<string, unknown>, errors: Errors) {
  const uid = String(p.friend_uid ?? p.uid ?? '')
  if (!uid) throw errors.missingParam('friend_uid')
  return postForm(page, '/ajax/friendships/destroy', `friend_uid=${encodeURIComponent(uid)}`, errors)
}

async function bookmarkPost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return postForm(page, '/ajax/statuses/createFavorites', `id=${encodeURIComponent(id)}`, errors)
}

async function unbookmarkPost(page: Page, p: Record<string, unknown>, errors: Errors) {
  const id = requireParam(p, 'id', errors)
  return postForm(page, '/ajax/statuses/destroyFavorites', `id=${encodeURIComponent(id)}`, errors)
}

/* ---------- adapter export ---------- */

type OpHandler = (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  getHotSearch, getHotFeed, getFriendsFeed, getPost, getLongtext, listComments, listReposts,
  getUserProfile, getUserDetail, getUserStatuses,
  likePost, unlikePost, repost, followUser, unfollowUser, bookmarkPost, unbookmarkPost,
}

const adapter: CustomRunner = {
  name: 'weibo-web',
  description: 'Weibo — page-context fetch for /ajax/* endpoints (Origin/Referer required by weibo CSRF)',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    if (!page) throw new Error('weibo-web adapter requires a browser page')
    const errors = helpers.errors as Errors
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw errors.unknownOp(operation)
      return await handler(page, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
