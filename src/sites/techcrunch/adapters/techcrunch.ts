import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://techcrunch.com/wp-json/wp/v2'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 15_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '')
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function extractAuthor(post: R): string | null {
  const yoast = post.yoast_head_json as R | undefined
  if (yoast?.author && typeof yoast.author === 'string') return yoast.author
  const parsely = post.parsely as R | undefined
  const meta = parsely?.meta as R | undefined
  const authors = meta?.author as Array<{ name?: string }> | undefined
  return authors?.[0]?.name ?? null
}

function extractSection(post: R): string | null {
  const parsely = post.parsely as R | undefined
  const meta = parsely?.meta as R | undefined
  return (meta?.articleSection as string) ?? null
}

function extractKeywords(post: R): string[] | null {
  const parsely = post.parsely as R | undefined
  const meta = parsely?.meta as R | undefined
  const keywords = meta?.keywords as string[] | undefined
  return keywords?.length ? keywords : null
}

function trimListItem(post: R): R {
  return {
    id: post.id,
    date: post.date,
    slug: post.slug,
    link: post.link,
    title: (post.title as R)?.rendered ?? null,
    excerpt: (post.excerpt as R)?.rendered ?? null,
    author: extractAuthor(post),
    categories: post.categories,
    featured_image_url: post.jetpack_featured_media_url ?? null,
  }
}

function trimArticle(post: R): R {
  return {
    ...trimListItem(post),
    modified: post.modified,
    content: (post.content as R)?.rendered ?? null,
    tags: post.tags,
    section: extractSection(post),
    keywords: extractKeywords(post),
  }
}

async function searchArticles(params: Params, errors: Errors): Promise<unknown> {
  if (!params.search) throw errors.missingParam('search')
  const raw = await fetchJson(
    `${BASE}/posts${qs({
      search: params.search,
      per_page: params.per_page,
      page: params.page,
      orderby: params.orderby,
      order: params.order,
    })}`,
    errors,
  )
  return (raw as R[]).map(trimListItem)
}

async function getArticle(params: Params, errors: Errors): Promise<unknown> {
  if (!params.id) throw errors.missingParam('id')
  const raw = await fetchJson(`${BASE}/posts/${params.id}`, errors)
  return trimArticle(raw as R)
}

async function getLatest(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(
    `${BASE}/posts${qs({
      per_page: params.per_page,
      page: params.page,
    })}`,
    errors,
  )
  return (raw as R[]).map(trimListItem)
}

async function getCategory(params: Params, errors: Errors): Promise<unknown> {
  if (!params.categories) throw errors.missingParam('categories')
  const raw = await fetchJson(
    `${BASE}/posts${qs({
      categories: params.categories,
      per_page: params.per_page,
      page: params.page,
      orderby: params.orderby,
      order: params.order,
    })}`,
    errors,
  )
  return (raw as R[]).map(trimListItem)
}

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchArticles,
  getArticle,
  getLatest,
  getCategory,
}

const adapter: CustomRunner = {
  name: 'techcrunch',
  description: 'TechCrunch — response trimming for all 4 read ops',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
