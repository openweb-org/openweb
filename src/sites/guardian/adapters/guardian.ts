import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://content.guardianapis.com'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<R> {
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

function trimArticle(item: R): R {
  const fields = item.fields as R | undefined
  const result: R = {
    id: item.id,
    type: item.type,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
    webPublicationDate: item.webPublicationDate,
    webTitle: item.webTitle,
    webUrl: item.webUrl,
    pillarName: item.pillarName ?? null,
  }
  if (fields) result.fields = fields
  return result
}

async function searchArticles(params: Params, errors: Errors): Promise<unknown> {
  if (!params.q) throw errors.missingParam('q')
  const raw = await fetchJson(
    `${BASE}/search${qs({
      q: params.q,
      'api-key': params['api-key'] ?? 'test',
      'show-fields': params['show-fields'] ?? 'headline,byline,thumbnail',
      'page-size': params['page-size'],
      page: params.page,
      'order-by': params['order-by'],
    })}`,
    errors,
  )
  const response = raw.response as R
  const results = (response?.results as R[]) ?? []
  return results.map(trimArticle)
}

async function getArticle(params: Params, errors: Errors): Promise<unknown> {
  if (!params.ids) throw errors.missingParam('ids')
  const raw = await fetchJson(
    `${BASE}/search${qs({
      ids: params.ids,
      'api-key': params['api-key'] ?? 'test',
      'show-fields': params['show-fields'] ?? 'body,headline,byline,thumbnail',
    })}`,
    errors,
  )
  const response = raw.response as R
  const results = (response?.results as R[]) ?? []
  const item = results[0]
  if (!item) throw errors.apiError('getArticle', 'Article not found')
  return trimArticle(item)
}

async function getSectionFeed(params: Params, errors: Errors): Promise<unknown> {
  if (!params.section) throw errors.missingParam('section')
  const raw = await fetchJson(
    `${BASE}/search${qs({
      section: params.section,
      'api-key': params['api-key'] ?? 'test',
      'show-fields': params['show-fields'] ?? 'headline,byline,thumbnail',
      'order-by': params['order-by'] ?? 'newest',
      'page-size': params['page-size'],
      page: params.page,
    })}`,
    errors,
  )
  const response = raw.response as R
  const results = (response?.results as R[]) ?? []
  return results.map(trimArticle)
}

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchArticles,
  getArticle,
  getSectionFeed,
}

const adapter: CustomRunner = {
  name: 'guardian',
  description: 'The Guardian — response trimming for all 3 read ops',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
