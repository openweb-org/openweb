import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { AdapterErrorHelpers, CustomRunner } from '../../../types/adapter.js'

const API = 'https://public.api.bsky.app'

type Params = Readonly<Record<string, unknown>>

async function fetchJson(url: string, errors: AdapterErrorHelpers): Promise<Record<string, unknown>> {
  const { status, text } = await nodeFetch({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      for (const item of v) p.append(k, String(item))
    } else {
      p.set(k, String(v))
    }
  }
  return p.toString()
}

/* ── trimming helpers ── */

function trimAuthor(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    did: a.did,
    handle: a.handle,
  }
  if (a.displayName) out.displayName = a.displayName
  if (a.avatar) out.avatar = a.avatar
  if (a.description) out.description = a.description
  if (a.followersCount !== undefined) out.followersCount = a.followersCount
  if (a.followsCount !== undefined) out.followsCount = a.followsCount
  if (a.postsCount !== undefined) out.postsCount = a.postsCount

  const v = a.verification as Record<string, unknown> | undefined
  if (v?.verifiedStatus && v.verifiedStatus !== 'none') out.verifiedStatus = v.verifiedStatus
  return out
}

function trimEmbed(embed: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!embed) return undefined
  const type = embed.$type as string | undefined

  if (type === 'app.bsky.embed.images#view') {
    const images = embed.images as Array<Record<string, unknown>> | undefined
    return {
      type: 'images',
      images: images?.map(i => ({ thumb: i.thumb, fullsize: i.fullsize, alt: i.alt || undefined })),
    }
  }
  if (type === 'app.bsky.embed.external#view') {
    const ext = embed.external as Record<string, unknown> | undefined
    return ext ? { type: 'external', uri: ext.uri, title: ext.title, description: ext.description } : undefined
  }
  if (type === 'app.bsky.embed.record#view') {
    const rec = embed.record as Record<string, unknown> | undefined
    if (!rec) return undefined
    const author = rec.author as Record<string, unknown> | undefined
    return {
      type: 'quote',
      uri: rec.uri,
      cid: rec.cid,
      author: author ? { did: author.did, handle: author.handle, displayName: author.displayName } : undefined,
      value: trimRecordText(rec.value as Record<string, unknown> | undefined),
    }
  }
  if (type === 'app.bsky.embed.recordWithMedia#view') {
    const inner: Record<string, unknown> = {}
    if (embed.record) {
      const rView = (embed.record as Record<string, unknown>).record as Record<string, unknown> | undefined
      if (rView) {
        const author = rView.author as Record<string, unknown> | undefined
        inner.quote = {
          uri: rView.uri, cid: rView.cid,
          author: author ? { did: author.did, handle: author.handle, displayName: author.displayName } : undefined,
          value: trimRecordText(rView.value as Record<string, unknown> | undefined),
        }
      }
    }
    if (embed.media) inner.media = trimEmbed(embed.media as Record<string, unknown>)
    return { type: 'recordWithMedia', ...inner }
  }
  if (type === 'app.bsky.embed.video#view') {
    return { type: 'video', thumbnail: embed.thumbnail, playlist: embed.playlist, alt: embed.alt || undefined }
  }
  return { type: type ?? 'unknown' }
}

function trimRecordText(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined
  const out: Record<string, unknown> = {}
  if (record.text) out.text = record.text
  if (record.createdAt) out.createdAt = record.createdAt
  return out
}

function trimRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (record.text) out.text = record.text
  if (record.createdAt) out.createdAt = record.createdAt
  if (record.langs) out.langs = record.langs
  if (record.reply) out.reply = record.reply
  return out
}

function trimPost(p: Record<string, unknown>): Record<string, unknown> {
  const author = p.author as Record<string, unknown> | undefined
  const record = p.record as Record<string, unknown> | undefined
  const embed = p.embed as Record<string, unknown> | undefined

  return {
    uri: p.uri,
    cid: p.cid,
    author: author ? trimAuthor(author) : undefined,
    record: record ? trimRecord(record) : undefined,
    embed: trimEmbed(embed),
    likeCount: p.likeCount,
    repostCount: p.repostCount,
    replyCount: p.replyCount,
    quoteCount: p.quoteCount,
    indexedAt: p.indexedAt,
  }
}

function trimPostRef(p: Record<string, unknown>): Record<string, unknown> {
  const author = p.author as Record<string, unknown> | undefined
  const record = p.record as Record<string, unknown> | undefined
  const text = record?.text as string | undefined
  return {
    uri: p.uri,
    author: author ? { handle: author.handle, displayName: author.displayName } : undefined,
    text: text && text.length > 120 ? `${text.slice(0, 120)}…` : text,
  }
}

function trimFeedItem(item: Record<string, unknown>): Record<string, unknown> {
  const post = item.post as Record<string, unknown>
  const out: Record<string, unknown> = { post: trimPost(post) }

  const reply = item.reply as Record<string, unknown> | undefined
  if (reply) {
    const r: Record<string, unknown> = {}
    if (reply.root) r.root = trimPostRef(reply.root as Record<string, unknown>)
    if (reply.parent && reply.parent !== reply.root) r.parent = trimPostRef(reply.parent as Record<string, unknown>)
    out.reply = r
  }

  const reason = item.reason as Record<string, unknown> | undefined
  if (reason) out.reason = { type: reason.$type, by: reason.by ? trimAuthor(reason.by as Record<string, unknown>) : undefined }

  return out
}

const MAX_THREAD_REPLIES = 30

function trimThreadNode(node: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (node.post) out.post = trimPost(node.post as Record<string, unknown>)

  if (node.parent) {
    const parent = node.parent as Record<string, unknown>
    if (parent.post) out.parent = trimThreadNode(parent, depth)
  }

  const replies = node.replies as Array<Record<string, unknown>> | undefined
  if (replies?.length) {
    const limited = replies.slice(0, depth > 0 ? MAX_THREAD_REPLIES : 10)
    out.replies = limited.map(r => {
      if (r.$type === 'app.bsky.feed.defs#blockedPost' || r.$type === 'app.bsky.feed.defs#notFoundPost') {
        return { $type: r.$type, uri: r.uri }
      }
      return trimThreadNode(r, depth > 0 ? depth - 1 : 0)
    })
    if (replies.length > limited.length) out.repliesTruncated = replies.length
  }

  return out
}

function trimActorProfile(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    did: a.did,
    handle: a.handle,
  }
  if (a.displayName) out.displayName = a.displayName
  if (a.avatar) out.avatar = a.avatar
  if (a.description) out.description = a.description
  if (a.followersCount !== undefined) out.followersCount = a.followersCount
  if (a.followsCount !== undefined) out.followsCount = a.followsCount
  if (a.postsCount !== undefined) out.postsCount = a.postsCount
  if (a.createdAt) out.createdAt = a.createdAt
  if (a.indexedAt) out.indexedAt = a.indexedAt

  const v = a.verification as Record<string, unknown> | undefined
  if (v?.verifiedStatus && v.verifiedStatus !== 'none') out.verifiedStatus = v.verifiedStatus
  return out
}

/* ── operations ── */

async function getProfile(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const actor = params.actor as string | undefined
  if (!actor) throw errors.missingParam('actor')

  const data = await fetchJson(`${API}/xrpc/app.bsky.actor.getProfile?${qs({ actor })}`, errors)

  const out: Record<string, unknown> = {
    did: data.did,
    handle: data.handle,
  }
  if (data.displayName) out.displayName = data.displayName
  if (data.description) out.description = data.description
  if (data.avatar) out.avatar = data.avatar
  if (data.banner) out.banner = data.banner
  if (data.followersCount !== undefined) out.followersCount = data.followersCount
  if (data.followsCount !== undefined) out.followsCount = data.followsCount
  if (data.postsCount !== undefined) out.postsCount = data.postsCount
  if (data.createdAt) out.createdAt = data.createdAt
  if (data.indexedAt) out.indexedAt = data.indexedAt

  const v = data.verification as Record<string, unknown> | undefined
  if (v?.verifiedStatus && v.verifiedStatus !== 'none') out.verifiedStatus = v.verifiedStatus

  if (data.pinnedPost) out.pinnedPost = data.pinnedPost
  return out
}

async function getPostThread(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const uri = params.uri as string | undefined
  if (!uri) throw errors.missingParam('uri')

  const depth = (params.depth as number | undefined) ?? 6
  const parentHeight = params.parentHeight as number | undefined

  const q: Record<string, unknown> = { uri, depth }
  if (parentHeight !== undefined) q.parentHeight = parentHeight

  const data = await fetchJson(`${API}/xrpc/app.bsky.feed.getPostThread?${qs(q)}`, errors)
  const thread = data.thread as Record<string, unknown>
  return { thread: trimThreadNode(thread, 2) }
}

async function getFeed(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const feed = params.feed as string | undefined
  if (!feed) throw errors.missingParam('feed')

  const q: Record<string, unknown> = { feed }
  if (params.limit) q.limit = params.limit
  if (params.cursor) q.cursor = params.cursor

  const data = await fetchJson(`${API}/xrpc/app.bsky.feed.getFeed?${qs(q)}`, errors)
  const items = (data.feed as Array<Record<string, unknown>>) ?? []

  const out: Record<string, unknown> = { feed: items.map(trimFeedItem) }
  if (data.cursor) out.cursor = data.cursor
  return out
}

async function getAuthorFeed(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const actor = params.actor as string | undefined
  if (!actor) throw errors.missingParam('actor')

  const q: Record<string, unknown> = { actor }
  if (params.limit) q.limit = params.limit
  if (params.cursor) q.cursor = params.cursor
  if (params.filter) q.filter = params.filter

  const data = await fetchJson(`${API}/xrpc/app.bsky.feed.getAuthorFeed?${qs(q)}`, errors)
  const items = (data.feed as Array<Record<string, unknown>>) ?? []

  const out: Record<string, unknown> = { feed: items.map(trimFeedItem) }
  if (data.cursor) out.cursor = data.cursor
  return out
}

async function searchActors(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const q = params.q as string | undefined
  if (!q) throw errors.missingParam('q')

  const query: Record<string, unknown> = { q }
  if (params.limit) query.limit = params.limit
  if (params.cursor) query.cursor = params.cursor

  const data = await fetchJson(`${API}/xrpc/app.bsky.actor.searchActors?${qs(query)}`, errors)
  const actors = (data.actors as Array<Record<string, unknown>>) ?? []

  const out: Record<string, unknown> = { actors: actors.map(trimActorProfile) }
  if (data.cursor) out.cursor = data.cursor
  return out
}

async function getFollowers(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const actor = params.actor as string | undefined
  if (!actor) throw errors.missingParam('actor')

  const q: Record<string, unknown> = { actor }
  if (params.limit) q.limit = params.limit
  if (params.cursor) q.cursor = params.cursor

  const data = await fetchJson(`${API}/xrpc/app.bsky.graph.getFollowers?${qs(q)}`, errors)
  const followers = (data.followers as Array<Record<string, unknown>>) ?? []
  const subject = data.subject as Record<string, unknown>

  const out: Record<string, unknown> = {
    subject: trimActorProfile(subject),
    followers: followers.map(trimActorProfile),
  }
  if (data.cursor) out.cursor = data.cursor
  return out
}

async function getFollows(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const actor = params.actor as string | undefined
  if (!actor) throw errors.missingParam('actor')

  const q: Record<string, unknown> = { actor }
  if (params.limit) q.limit = params.limit
  if (params.cursor) q.cursor = params.cursor

  const data = await fetchJson(`${API}/xrpc/app.bsky.graph.getFollows?${qs(q)}`, errors)
  const follows = (data.follows as Array<Record<string, unknown>>) ?? []
  const subject = data.subject as Record<string, unknown>

  const out: Record<string, unknown> = {
    subject: trimActorProfile(subject),
    follows: follows.map(trimActorProfile),
  }
  if (data.cursor) out.cursor = data.cursor
  return out
}

async function getPosts(params: Params, errors: AdapterErrorHelpers): Promise<unknown> {
  const uris = params.uris as string[] | undefined
  if (!uris?.length) throw errors.missingParam('uris')

  const data = await fetchJson(`${API}/xrpc/app.bsky.feed.getPosts?${qs({ uris })}`, errors)
  const posts = (data.posts as Array<Record<string, unknown>>) ?? []
  return { posts: posts.map(trimPost) }
}

/* ── runner ── */

type OpHandler = (params: Params, errors: AdapterErrorHelpers) => Promise<unknown>

const OPS: Record<string, OpHandler> = {
  getProfile, getPostThread, getFeed, getAuthorFeed,
  searchActors, getFollowers, getFollows, getPosts,
}

const runner: CustomRunner = {
  name: 'bluesky-public',
  description: 'Bluesky public API with response trimming',

  async run(ctx) {
    const handler = OPS[ctx.operation]
    if (!handler) throw ctx.helpers.errors.unknownOp(ctx.operation)
    return handler(ctx.params, ctx.helpers.errors)
  },
}

export default runner
