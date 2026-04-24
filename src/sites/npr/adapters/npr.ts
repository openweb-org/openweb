import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://7s4f1grybg-dsn.algolia.net'
const INDEX = '/1/indexes/nprorg-cds'
const DEFAULT_KEY = 'f2f5be631a4287148759373ff4ab5227'
const DEFAULT_APP = '7S4F1GRYBG'
const TEASER_LIMIT = 300

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '')
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

async function fetchJson(url: string, errors: Errors): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 15_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function trimListItem(item: R): R {
  return {
    objectID: item.objectID ?? null,
    title: item.title ?? null,
    bodyText: truncate(item.bodyText as string | undefined),
    url: item.url ?? null,
    canonicalUrl: item.canonicalUrl ?? null,
    displayDate: item.displayDate ?? null,
    bylines: item.bylines ?? [],
    topics: item.topics ?? [],
    image: trimImage(item.image as R | undefined),
    hasAudio: item.hasAudio ?? false,
    type: item.type ?? null,
  }
}

function trimArticle(item: R): R {
  return {
    objectID: item.objectID ?? null,
    title: item.title ?? null,
    bodyText: item.bodyText ?? null,
    url: item.url ?? null,
    canonicalUrl: item.canonicalUrl ?? null,
    displayDate: item.displayDate ?? null,
    bylines: item.bylines ?? [],
    topics: item.topics ?? [],
    shows: item.shows ?? [],
    image: trimImage(item.image as R | undefined),
    hasAudio: item.hasAudio ?? false,
    slug: item.slug ?? null,
    type: item.type ?? null,
  }
}

function trimImage(img: R | undefined): R | null {
  if (!img || typeof img !== 'object' || !('url' in img) || !img.url) return null
  return { url: img.url, caption: img.caption ?? null, credit: img.credit ?? null }
}

function truncate(text: string | undefined): string | null {
  if (!text) return null
  if (text.length <= TEASER_LIMIT) return text
  const cut = text.lastIndexOf(' ', TEASER_LIMIT)
  return text.slice(0, cut > 0 ? cut : TEASER_LIMIT) + '…'
}

async function searchArticles(params: Params, errors: Errors): Promise<unknown> {
  if (!params.query) throw errors.missingParam('query')
  const raw = await fetchJson(
    `${BASE}${INDEX}${qs({
      query: params.query,
      'x-algolia-api-key': params['x-algolia-api-key'] ?? DEFAULT_KEY,
      'x-algolia-application-id': params['x-algolia-application-id'] ?? DEFAULT_APP,
      filters: params.filters ?? 'type:story',
      hitsPerPage: params.hitsPerPage ?? 10,
      page: params.page ?? 0,
    })}`,
    errors,
  )
  const hits = ((raw as R).hits as R[]) ?? []
  return hits.map(trimListItem)
}

async function getArticle(params: Params, errors: Errors): Promise<unknown> {
  if (!params.objectID) throw errors.missingParam('objectID')
  const raw = await fetchJson(
    `${BASE}${INDEX}/${encodeURIComponent(String(params.objectID))}${qs({
      'x-algolia-api-key': params['x-algolia-api-key'] ?? DEFAULT_KEY,
      'x-algolia-application-id': params['x-algolia-application-id'] ?? DEFAULT_APP,
    })}`,
    errors,
  )
  return trimArticle(raw as R)
}

async function getTopStories(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(
    `${BASE}${INDEX}${qs({
      query: params.query ?? '',
      'x-algolia-api-key': params['x-algolia-api-key'] ?? DEFAULT_KEY,
      'x-algolia-application-id': params['x-algolia-application-id'] ?? DEFAULT_APP,
      filters: params.filters ?? 'type:story AND topics:"Home Page Top Stories"',
      hitsPerPage: params.hitsPerPage ?? 10,
      page: params.page ?? 0,
    })}`,
    errors,
  )
  const hits = ((raw as R).hits as R[]) ?? []
  return hits.map(trimListItem)
}

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchArticles,
  getArticle,
  getTopStories,
}

const adapter: CustomRunner = {
  name: 'npr',
  description: 'NPR — response trimming for all 3 ops via Algolia',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
