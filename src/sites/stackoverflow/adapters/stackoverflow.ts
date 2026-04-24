import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://api.stackexchange.com/2.3'

const HTML_ENTITY: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#x27;': "'", '&#x2F;': '/', '&apos;': "'",
}
const ENTITY_RE = /&(?:#(?:x[0-9a-fA-F]+|[0-9]+)|[a-zA-Z]+);/g

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (m) => {
    if (HTML_ENTITY[m]) return HTML_ENTITY[m]
    if (m.startsWith('&#x')) return String.fromCharCode(Number.parseInt(m.slice(3, -1), 16))
    if (m.startsWith('&#')) return String.fromCharCode(Number.parseInt(m.slice(2, -1), 10))
    return m
  })
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => `\n\`\`\`\n${decodeEntities(code.trim())}\n\`\`\`\n`)
    .replace(/<code>([\s\S]*?)<\/code>/g, (_, code) => `\`${decodeEntities(code)}\``)
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, label) => `[${decodeEntities(label)}](${href})`)
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<\/?[^>]+>/g, '')
  text = decodeEntities(text)
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function trimOwner(owner: Record<string, unknown>): Record<string, unknown> {
  return {
    display_name: owner.display_name,
    reputation: owner.reputation,
    user_id: owner.user_id,
  }
}

type Item = Record<string, unknown>

function trimQuestion(q: Item): Item {
  const out: Item = {
    question_id: q.question_id,
    title: decodeEntities(q.title as string),
    link: q.link,
    score: q.score,
    answer_count: q.answer_count,
    is_answered: q.is_answered,
    view_count: q.view_count,
    tags: q.tags,
    creation_date: q.creation_date,
  }
  if (q.accepted_answer_id) out.accepted_answer_id = q.accepted_answer_id
  if (q.closed_reason) out.closed_reason = q.closed_reason
  if (q.body) out.body = stripHtml(q.body as string)
  if (q.owner) out.owner = trimOwner(q.owner as Record<string, unknown>)
  return out
}

function trimAnswer(a: Item): Item {
  const out: Item = {
    answer_id: a.answer_id,
    score: a.score,
    is_accepted: a.is_accepted,
    creation_date: a.creation_date,
  }
  if (a.body) out.body = stripHtml(a.body as string)
  if (a.owner) out.owner = trimOwner(a.owner as Record<string, unknown>)
  return out
}

function trimUser(u: Item): Item {
  return {
    user_id: u.user_id,
    display_name: u.display_name,
    reputation: u.reputation,
    badge_counts: u.badge_counts,
    accept_rate: u.accept_rate ?? null,
    location: u.location ?? null,
    link: u.link,
    creation_date: u.creation_date,
    last_access_date: u.last_access_date,
  }
}

function trimTag(t: Item): Item {
  return { name: t.name, count: t.count }
}

async function fetchApi(path: string, params: Record<string, string>, errors: AdapterErrorHelpers): Promise<Item[]> {
  const qs = new URLSearchParams(params)
  const url = `${API}${path}?${qs}`
  const { status, text } = await nodeFetch({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  const body = JSON.parse(text) as { items?: Item[]; error_id?: number; error_message?: string }
  if (body.error_id) throw errors.apiError('stackoverflow', body.error_message ?? `API error ${body.error_id}`)
  return body.items ?? []
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback
}

async function searchQuestions(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const q = params.q as string | undefined
  if (!q) throw errors.missingParam('q')
  const qs: Record<string, string> = {
    q, site: str(params.site, 'stackoverflow'),
    sort: str(params.sort, 'relevance'), order: str(params.order, 'desc'),
    pagesize: String(params.pagesize ?? 10), page: String(params.page ?? 1),
  }
  if (params.tagged) qs.tagged = params.tagged as string
  return (await fetchApi('/search/advanced', qs, errors)).map(trimQuestion)
}

async function getQuestion(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const qs: Record<string, string> = {
    site: str(params.site, 'stackoverflow'),
    filter: str(params.filter, 'withbody'),
  }
  const items = await fetchApi(`/questions/${id}`, qs, errors)
  if (!items.length) throw errors.apiError('stackoverflow', `Question ${id} not found`)
  return trimQuestion(items[0])
}

async function getAnswers(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const qs: Record<string, string> = {
    site: str(params.site, 'stackoverflow'),
    sort: str(params.sort, 'votes'), order: str(params.order, 'desc'),
    filter: str(params.filter, 'withbody'),
    pagesize: String(params.pagesize ?? 10), page: String(params.page ?? 1),
  }
  return (await fetchApi(`/questions/${id}/answers`, qs, errors)).map(trimAnswer)
}

async function getUser(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const id = params.id as number | undefined
  if (!id) throw errors.missingParam('id')
  const qs: Record<string, string> = { site: str(params.site, 'stackoverflow') }
  const items = await fetchApi(`/users/${id}`, qs, errors)
  if (!items.length) throw errors.apiError('stackoverflow', `User ${id} not found`)
  return trimUser(items[0])
}

async function searchTags(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const qs: Record<string, string> = {
    site: str(params.site, 'stackoverflow'),
    sort: str(params.sort, 'popular'), order: str(params.order, 'desc'),
    pagesize: String(params.pagesize ?? 10), page: String(params.page ?? 1),
  }
  if (params.inname) qs.inname = params.inname as string
  return (await fetchApi('/tags', qs, errors)).map(trimTag)
}

const OPERATIONS: Record<string, (p: Readonly<Record<string, unknown>>, e: AdapterErrorHelpers) => Promise<unknown>> = {
  searchQuestions, getQuestion, getAnswers, getUser, searchTags,
}

const adapter: CustomRunner = {
  name: 'stackoverflow',
  description: 'Stack Overflow — HTML entity decode, body→markdown, response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
