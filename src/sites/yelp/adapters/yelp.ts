import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://www.yelp.com'

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

function trimSuggestion(s: R): R {
  const out: R = {
    title: s.title ?? null,
    query: s.query ?? null,
    type: s.type ?? null,
  }
  if (s.subtitle) out.subtitle = s.subtitle
  if (s.redirect_url) out.redirect_url = s.redirect_url
  if (s.thumbnail && (s.thumbnail as R).key) {
    out.thumbnail = { url: (s.thumbnail as R).key, type: (s.thumbnail as R).type }
  }
  if (Array.isArray(s.refinements) && s.refinements.length > 0) {
    out.refinements = (s.refinements as R[]).map(r => ({
      title: r.title ?? null,
      query: r.query ?? null,
    }))
  }
  return out
}

async function autocompleteBusinesses(params: Params, errors: Errors): Promise<unknown> {
  if (!params.prefix) throw errors.missingParam('prefix')
  if (!params.loc) throw errors.missingParam('loc')

  const raw = await fetchJson(
    `${BASE}/search_suggest/v2/prefetch${qs({ prefix: params.prefix, loc: params.loc })}`,
    errors,
  )

  const response = (raw as R).response as R[] | undefined
  if (!Array.isArray(response) || response.length === 0) return []

  const group = response[0] as R
  const suggestions = (group.suggestions as R[]) ?? []
  return suggestions.map(trimSuggestion)
}

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  autocompleteBusinesses,
}

const adapter: CustomRunner = {
  name: 'yelp',
  description: 'Yelp — autocomplete response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
