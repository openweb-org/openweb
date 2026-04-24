import type { CustomRunner } from '../../../types/adapter.js'
import { DEFAULT_USER_AGENT } from '../../../lib/config.js'

type Params = Readonly<Record<string, unknown>>

const BASE = 'https://www.reddit.com'

function str(v: unknown): string { return v == null ? '' : String(v) }
function num(v: unknown): number | undefined { return v == null ? undefined : Number(v) }

async function redditGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': DEFAULT_USER_AGENT },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
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
        data: trimPost(c.data as Record<string, unknown>),
      })),
    },
  }
}

async function getSubredditPosts(params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  if (!sub) throw new Error('subreddit is required')
  const qs = buildQuery(params, ['sort', 't', 'limit', 'after'])
  const body = await redditGet(`/r/${encodeURIComponent(sub)}.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function getPopularPosts(params: Params): Promise<unknown> {
  const qs = buildQuery(params, ['limit', 'after'])
  const body = await redditGet(`/r/popular.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function searchPosts(params: Params): Promise<unknown> {
  const q = str(params.q)
  if (!q) throw new Error('q is required')
  const qs = buildQuery(params, ['q', 'sort', 't', 'limit', 'after', 'type'])
  const body = await redditGet(`/search.json${qs}`) as Record<string, unknown>
  return trimListing(body)
}

async function getPostComments(params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  const postId = str(params.post_id)
  if (!sub || !postId) throw new Error('subreddit and post_id are required')
  const qs = buildQuery(params, ['sort', 'limit'])
  const body = await redditGet(`/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(postId)}.json${qs}`) as Array<Record<string, unknown>>
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

async function getUserProfile(params: Params): Promise<unknown> {
  const username = str(params.username)
  if (!username) throw new Error('username is required')
  const body = await redditGet(`/user/${encodeURIComponent(username)}/about.json`) as Record<string, unknown>
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

async function getUserPosts(params: Params): Promise<unknown> {
  const username = str(params.username)
  if (!username) throw new Error('username is required')
  const qs = buildQuery(params, ['sort', 'limit', 'after'])
  const body = await redditGet(`/user/${encodeURIComponent(username)}.json${qs}`) as Record<string, unknown>
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

async function getSubredditAbout(params: Params): Promise<unknown> {
  const sub = str(params.subreddit)
  if (!sub) throw new Error('subreddit is required')
  const body = await redditGet(`/r/${encodeURIComponent(sub)}/about.json`) as Record<string, unknown>
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
  description: 'Reddit — public read operations with response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx

    switch (operation) {
      case 'getSubredditPosts': return getSubredditPosts(params)
      case 'getPopularPosts': return getPopularPosts(params)
      case 'searchPosts': return searchPosts(params)
      case 'getPostComments': return getPostComments(params)
      case 'getUserProfile': return getUserProfile(params)
      case 'getUserPosts': return getUserPosts(params)
      case 'getSubredditAbout': return getSubredditAbout(params)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
