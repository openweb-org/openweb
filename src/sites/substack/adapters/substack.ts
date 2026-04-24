import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://substack.com'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function subdomainBase(params: Params): string {
  const sub = params.subdomain as string
  return `https://${encodeURIComponent(sub)}.substack.com`
}

// ── Trim helpers ───────────────────────────────────────

function trimByline(b: R): R {
  return { id: b.id, name: b.name }
}

function trimBylineDetailed(b: R): R {
  return { id: b.id, name: b.name, handle: b.handle ?? null, photo_url: b.photo_url ?? null }
}

function trimArchivePost(p: R): R {
  const bylines = p.publishedBylines as R[] | undefined
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle ?? null,
    slug: p.slug,
    type: p.type,
    post_date: p.post_date,
    canonical_url: p.canonical_url,
    audience: p.audience,
    description: p.description ?? null,
    word_count: p.wordcount ?? p.word_count ?? null,
    reaction_count: p.reaction_count ?? 0,
    comment_count: p.comment_count ?? 0,
    cover_image: p.cover_image ?? null,
    publishedBylines: (bylines ?? []).map(trimByline),
  }
}

function trimPostDetail(p: R): R {
  const bylines = p.publishedBylines as R[] | undefined
  const html = p.body_html as string | null
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle ?? null,
    slug: p.slug,
    type: p.type,
    post_date: p.post_date,
    canonical_url: p.canonical_url,
    audience: p.audience,
    description: p.description ?? null,
    body_html: html && html.length > 80_000 ? `${html.slice(0, 80_000)}…` : html,
    truncated_body_text: p.truncated_body_text ?? null,
    word_count: p.wordcount ?? p.word_count ?? null,
    reaction_count: p.reaction_count ?? 0,
    comment_count: p.comment_count ?? 0,
    cover_image: p.cover_image ?? null,
    publishedBylines: (bylines ?? []).map(trimBylineDetailed),
  }
}

function trimComment(c: R): R {
  const children = c.children as R[] | undefined
  return {
    id: c.id,
    body: c.body,
    date: c.date,
    name: c.name,
    user_id: c.user_id,
    photo_url: c.photo_url ?? null,
    reaction_count: c.reaction_count ?? 0,
    children: (children ?? []).map(trimComment),
  }
}

// ── Operations ─────────────────────────────────────────

async function searchPosts(params: Params, errors: Errors): Promise<unknown> {
  const query = params.query as string | undefined
  if (!query) throw errors.missingParam('query')
  const page = params.page as number | undefined
  const url = `${BASE}/api/v1/top/search?query=${encodeURIComponent(query)}&fromSuggestedSearch=false${page ? `&cursor=${encodeURIComponent(String(page))}` : ''}`
  const raw = await fetchJson(url, errors) as R

  const items = raw.items as R[] | undefined
  const results: R[] = []
  for (const item of items ?? []) {
    if (item.type !== 'post') continue
    const post = item.post as R | undefined
    const pub = item.publication as R | undefined
    if (!post) continue
    const bylines = (post.publishedBylines as R[]) ?? []
    results.push({
      id: post.id,
      title: post.title,
      subtitle: post.subtitle ?? null,
      slug: post.slug,
      post_date: post.post_date,
      canonical_url: post.canonical_url,
      audience: post.audience,
      reaction_count: post.reaction_count ?? 0,
      comment_count: post.comment_count ?? 0,
      publishedBylines: bylines.map(trimByline),
      publication: pub ? { id: pub.id, name: pub.name, subdomain: pub.subdomain } : null,
    })
  }
  return { results, more: !!raw.nextCursor }
}

async function getArchive(params: Params, errors: Errors): Promise<unknown> {
  const base = subdomainBase(params)
  const sort = (params.sort as string) ?? 'new'
  const search = params.search as string | undefined
  const offset = params.offset as number ?? 0
  const limit = params.limit as number ?? 12
  let url = `${base}/api/v1/archive?sort=${sort}&offset=${offset}&limit=${limit}`
  if (search) url += `&search=${encodeURIComponent(search)}`
  const raw = await fetchJson(url, errors) as R[]
  return raw.map(trimArchivePost)
}

async function getPost(params: Params, errors: Errors): Promise<unknown> {
  const base = subdomainBase(params)
  const slug = params.slug as string | undefined
  if (!slug) throw errors.missingParam('slug')
  const url = `${base}/api/v1/posts/${encodeURIComponent(slug)}`
  const raw = await fetchJson(url, errors) as R
  return trimPostDetail(raw)
}

async function getPostComments(params: Params, errors: Errors): Promise<unknown> {
  const base = subdomainBase(params)
  const postId = params.postId as number | undefined
  if (!postId) throw errors.missingParam('postId')
  const allComments = params.all_comments ?? true
  const sort = (params.sort as string) ?? 'best_first'
  const token = (params.token as string) ?? ''
  const url = `${base}/api/v1/post/${postId}/comments?token=${encodeURIComponent(token)}&all_comments=${allComments}&sort=${sort}`
  const raw = await fetchJson(url, errors) as R
  const comments = raw.comments as R[] | undefined
  return { comments: (comments ?? []).map(trimComment) }
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchPosts,
  getArchive,
  getPost,
  getPostComments,
}

const adapter: CustomRunner = {
  name: 'substack',
  description: 'Substack REST API — response trimming for all 4 read ops, node transport',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
