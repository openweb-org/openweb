import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type GetFn = (path: string) => Promise<unknown>

const BASE = 'https://www.reddit.com'

function str(v: unknown): string { return v == null ? '' : String(v) }

/** Pull a concise message out of Reddit's error body so the caller can see any
 *  stated wait time. Skips bot-wall HTML; prefers JSON `message`/`reason`. */
function extractApiMessage(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) return ''
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>
    const m = j.message ?? j.reason ?? j.error
    if (m != null) return String(m)
  } catch { /* not JSON — fall through */ }
  return trimmed.slice(0, 200)
}

/**
 * Browser-context GET against Reddit's public JSON API.
 *
 * Reddit's anti-bot blocks plain server-side fetches (datacenter IP + static
 * UA → 403 challenge / 429). Running the request inside the page via pageFetch
 * gives it the real browser fingerprint and the ambient reddit.com session
 * cookies (credentials:'include') — a logged-in session is what clears the JS
 * challenge. `raw_json=1` disables HTML-entity encoding of URLs in the body.
 *
 * 403 → bot/challenge wall (retriable). 429 → rate-limited: surfaced with
 * Reddit's own message and NOT auto-retried, so an already-throttled session
 * is not hammered.
 */
async function redditGet(page: Page, helpers: AdapterHelpers, path: string): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}raw_json=1`
  const result = await pageFetch(page, {
    url,
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (result.status === 429) {
    const apiMsg = extractApiMessage(result.text)
    throw errors.rateLimited(`Reddit rate-limited this request (HTTP 429).${apiMsg ? ` ${apiMsg}` : ''}`)
  }
  if (result.status === 403) throw errors.botBlocked('Reddit blocked the request (HTTP 403)')
  if (result.status === 401) throw errors.needsLogin()
  if (result.status >= 400) throw errors.httpError(result.status)
  try { return JSON.parse(result.text) } catch { throw errors.apiError('reddit', 'Response is not valid JSON') }
}

function trimPost(raw: Record<string, unknown>) {
  return {
    id: raw.id,
    name: raw.name,
    title: raw.title,
    author: raw.author,
    subreddit: raw.subreddit,
    score: raw.score,
    upvote_ratio: raw.upvote_ratio,
    num_comments: raw.num_comments,
    url: raw.url,
    permalink: raw.permalink,
    selftext: raw.selftext,
    created_utc: raw.created_utc,
    is_self: raw.is_self,
    over_18: raw.over_18,
    stickied: raw.stickied,
    thumbnail: raw.thumbnail,
    domain: raw.domain,
    link_flair_text: raw.link_flair_text ?? null,
  }
}

function trimComment(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: raw.id,
    name: raw.name,
    author: raw.author,
    score: raw.score,
    body: raw.body,
    depth: raw.depth,
    parent_id: raw.parent_id,
    is_submitter: raw.is_submitter,
    created_utc: raw.created_utc,
    permalink: raw.permalink,
  }
  if (raw.replies && typeof raw.replies === 'object') {
    const listing = raw.replies as Record<string, unknown>
    const data = listing.data as Record<string, unknown> | undefined
    if (data?.children) {
      result.replies = {
        data: {
          children: (data.children as Array<Record<string, unknown>>).map(c => {
            if (c.kind === 't1') return { kind: 't1', data: trimComment(c.data as Record<string, unknown>) }
            return c
          }),
        },
      }
    }
  } else {
    result.replies = raw.replies
  }
  return result
}

function buildQuery(params: Params, keys: string[]): string {
  const parts: string[] = []
  for (const k of keys) {
    if (params[k] != null) parts.push(`${k}=${encodeURIComponent(String(params[k]))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function trimListing(body: Record<string, unknown>) {
  const data = body.data as Record<string, unknown>
  const children = (data.children as Array<Record<string, unknown>>) ?? []
  return {
    kind: body.kind,
    data: {
      after: data.after ?? null,
      dist: data.dist,
      children: children.map(c => ({
        kind: c.kind,
        data: trimByKind(c.kind as string, c.data as Record<string, unknown>),
      })),
    },
  }
}

function trimByKind(kind: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (kind === 't5') return trimSubreddit(raw)
  if (kind === 't2') return trimUser(raw)
  return trimPost(raw)
}

function trimSubreddit(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw.id,
    name: raw.name,
    display_name: raw.display_name,
    display_name_prefixed: raw.display_name_prefixed,
    title: raw.title,
    public_description: raw.public_description,
    subscribers: raw.subscribers,
    accounts_active: raw.accounts_active ?? null,
    created_utc: raw.created_utc,
    url: raw.url,
    over18: raw.over18,
    subreddit_type: raw.subreddit_type,
    icon_img: raw.icon_img,
  }
}

function trimUser(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw.id,
    name: raw.name,
    link_karma: raw.link_karma,
    comment_karma: raw.comment_karma,
    total_karma: raw.total_karma,
    created_utc: raw.created_utc,
    icon_img: raw.icon_img,
    is_gold: raw.is_gold,
    verified: raw.verified,
  }
}

async function getSubredditPosts(get: GetFn, params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  if (!sub) throw new Error('subreddit is required')
  const sort = str(params.sort)
  const sortPath = sort ? `/${encodeURIComponent(sort)}` : ''
  const qs = buildQuery(params, ['t', 'limit', 'after'])
  const body = await get(`/r/${encodeURIComponent(sub)}${sortPath}.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function getPopularPosts(get: GetFn, params: Params): Promise<unknown> {
  const qs = buildQuery(params, ['limit', 'after'])
  const body = await get(`/r/popular.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function searchPosts(get: GetFn, params: Params): Promise<unknown> {
  const q = str(params.q)
  if (!q) throw new Error('q is required')
  const qs = buildQuery(params, ['q', 'sort', 't', 'limit', 'after', 'type'])
  const body = await get(`/search.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function getPostComments(get: GetFn, params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  const postId = str(params.post_id)
  if (!sub || !postId) throw new Error('subreddit and post_id are required')
  const qs = buildQuery(params, ['sort', 'limit'])
  const body = await get(`/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(postId)}.json${qs}`) as unknown
  if (!Array.isArray(body) || body.length < 2) throw new Error('Unexpected response format from Reddit comments endpoint')
  const postListing = body[0]
  const commentListing = body[1]
  const postData = (postListing.data as Record<string, unknown>)
  const postChildren = (postData.children as Array<Record<string, unknown>>) ?? []
  const commentData = (commentListing.data as Record<string, unknown>)
  const commentChildren = (commentData.children as Array<Record<string, unknown>>) ?? []
  return [
    {
      kind: postListing.kind,
      data: {
        after: postData.after ?? null,
        children: postChildren.map(c => ({
          kind: c.kind,
          data: trimPost(c.data as Record<string, unknown>),
        })),
      },
    },
    {
      kind: commentListing.kind,
      data: {
        after: commentData.after ?? null,
        children: commentChildren.map(c => {
          if (c.kind === 't1') return { kind: 't1', data: trimComment(c.data as Record<string, unknown>) }
          return c
        }),
      },
    },
  ]
}

async function getUserProfile(get: GetFn, params: Params): Promise<unknown> {
  const username = str(params.username)
  if (!username) throw new Error('username is required')
  const body = await get(`/user/${encodeURIComponent(username)}/about.json`) as Record<string, unknown>
  const d = body.data as Record<string, unknown>
  return {
    kind: body.kind,
    data: {
      name: d.name,
      id: d.id,
      verified: d.verified,
      is_gold: d.is_gold,
      is_mod: d.is_mod,
      is_employee: d.is_employee,
      link_karma: d.link_karma,
      comment_karma: d.comment_karma,
      total_karma: d.total_karma,
      created: d.created,
      created_utc: d.created_utc,
      icon_img: d.icon_img,
      has_verified_email: d.has_verified_email,
    },
  }
}

async function getUserPosts(get: GetFn, params: Params): Promise<unknown> {
  const username = str(params.username)
  if (!username) throw new Error('username is required')
  const qs = buildQuery(params, ['sort', 'limit', 'after'])
  const body = await get(`/user/${encodeURIComponent(username)}.json${qs}`) as Record<string, unknown>
  const data = body.data as Record<string, unknown>
  const children = (data.children as Array<Record<string, unknown>>) ?? []
  return {
    kind: body.kind,
    data: {
      after: data.after ?? null,
      dist: data.dist,
      children: children.map(c => {
        const d = c.data as Record<string, unknown>
        if (c.kind === 't3') return { kind: 't3', data: trimPost(d) }
        return {
          kind: c.kind,
          data: {
            id: d.id,
            name: d.name,
            author: d.author,
            subreddit: d.subreddit,
            score: d.score,
            created_utc: d.created_utc,
            permalink: d.permalink,
            body: d.body,
            parent_id: d.parent_id,
          },
        }
      }),
    },
  }
}

async function getSubredditAbout(get: GetFn, params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  if (!sub) throw new Error('subreddit is required')
  const body = await get(`/r/${encodeURIComponent(sub)}/about.json`) as Record<string, unknown>
  const d = body.data as Record<string, unknown>
  return {
    kind: body.kind,
    data: {
      display_name: d.display_name,
      display_name_prefixed: d.display_name_prefixed,
      title: d.title,
      public_description: d.public_description,
      description: d.description,
      subscribers: d.subscribers,
      accounts_active: d.accounts_active ?? null,
      created: d.created,
      created_utc: d.created_utc,
      icon_img: d.icon_img,
      community_icon: d.community_icon,
      header_img: d.header_img ?? null,
      quarantine: d.quarantine,
      over18: d.over18,
      subreddit_type: d.subreddit_type,
    },
  }
}

const adapter: CustomRunner = {
  name: 'reddit-read',
  description: 'Reddit — public read operations via browser session (cookie-aware, anti-bot resilient)',

  async run(ctx) {
    const { operation, params, helpers, page } = ctx
    if (!page) throw helpers.errors.fatal('reddit-read requires a browser page (transport: page)')
    const get: GetFn = (path) => redditGet(page, helpers, path)

    switch (operation) {
      case 'getSubredditPosts': return getSubredditPosts(get, params)
      case 'getPopularPosts': return getPopularPosts(get, params)
      case 'searchPosts': return searchPosts(get, params)
      case 'getPostComments': return getPostComments(get, params)
      case 'getUserProfile': return getUserProfile(get, params)
      case 'getUserPosts': return getUserPosts(get, params)
      case 'getSubredditAbout': return getSubredditAbout(get, params)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
