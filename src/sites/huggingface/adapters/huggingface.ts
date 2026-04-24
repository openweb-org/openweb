import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://huggingface.co/api'

async function fetchJson(url: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20_000 })
  if (status === 404) throw errors.apiError('huggingface', 'Not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, string | number>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

type Params = Readonly<Record<string, unknown>>

async function searchModels(params: Params, errors: AdapterErrorHelpers) {
  const search = params.search as string | undefined
  if (!search) throw errors.missingParam('search')

  const limit = (params.limit as number | undefined) ?? 20
  const sort = (params.sort as string | undefined) ?? 'downloads'
  const direction = (params.direction as number | undefined) ?? -1
  const filter = params.filter as string | undefined
  const author = params.author as string | undefined

  const q: Record<string, string | number> = { search, limit, sort, direction }
  if (filter) q.pipeline_tag = filter
  if (author) q.author = author

  const raw = await fetchJson(`${API}/models${qs(q)}`, errors) as Array<Record<string, unknown>>

  return raw.map(m => ({
    id: m.id,
    author: m.author ?? (m.id as string)?.split('/')[0],
    pipeline_tag: m.pipeline_tag ?? null,
    library_name: m.library_name ?? null,
    downloads: m.downloads,
    likes: m.likes,
    createdAt: m.createdAt ?? null,
  }))
}

async function getModel(params: Params, errors: AdapterErrorHelpers) {
  const owner = params.owner as string | undefined
  const name = params.name as string | undefined
  if (!owner) throw errors.missingParam('owner')
  if (!name) throw errors.missingParam('name')

  const raw = await fetchJson(`${API}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, errors) as Record<string, unknown>

  const cardData = raw.cardData as Record<string, unknown> | undefined
  const safetensors = raw.safetensors as Record<string, unknown> | undefined
  const siblings = raw.siblings as Array<Record<string, unknown>> | undefined
  const spaces = raw.spaces as string[] | undefined

  let parameters: number | null = null
  if (safetensors) {
    if (typeof safetensors.total === 'number') {
      parameters = safetensors.total
    } else if (safetensors.parameters && typeof safetensors.parameters === 'object') {
      const counts = Object.values(safetensors.parameters as Record<string, number>)
      if (counts.length) parameters = Math.max(...counts)
    }
  }

  return {
    id: raw.id,
    author: raw.author,
    pipeline_tag: raw.pipeline_tag ?? null,
    library_name: raw.library_name ?? null,
    downloads: raw.downloads,
    likes: raw.likes,
    lastModified: raw.lastModified,
    gated: raw.gated ?? false,
    tags: raw.tags,
    cardData: cardData ? {
      license: cardData.license ?? null,
      language: cardData.language ?? null,
      datasets: cardData.datasets ?? null,
      tags: cardData.tags ?? null,
      pipeline_tag: cardData.pipeline_tag ?? null,
    } : null,
    parameters,
    spaces: spaces?.slice(0, 5) ?? [],
    files: siblings?.map(s => s.rfilename) ?? [],
  }
}

async function searchDatasets(params: Params, errors: AdapterErrorHelpers) {
  const search = params.search as string | undefined
  if (!search) throw errors.missingParam('search')

  const limit = (params.limit as number | undefined) ?? 20
  const sort = (params.sort as string | undefined) ?? 'downloads'
  const direction = (params.direction as number | undefined) ?? -1
  const author = params.author as string | undefined

  const q: Record<string, string | number> = { search, limit, sort, direction }
  if (author) q.author = author

  const raw = await fetchJson(`${API}/datasets${qs(q)}`, errors) as Array<Record<string, unknown>>

  return raw.map(d => ({
    id: d.id,
    author: d.author ?? (d.id as string)?.split('/')[0],
    downloads: d.downloads,
    likes: d.likes,
    tags: d.tags,
    createdAt: d.createdAt ?? null,
  }))
}

async function getDataset(params: Params, errors: AdapterErrorHelpers) {
  const owner = params.owner as string | undefined
  const name = params.name as string | undefined
  if (!owner) throw errors.missingParam('owner')
  if (!name) throw errors.missingParam('name')

  const raw = await fetchJson(`${API}/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, errors) as Record<string, unknown>

  const cardData = raw.cardData as Record<string, unknown> | undefined
  const siblings = raw.siblings as Array<Record<string, unknown>> | undefined

  return {
    id: raw.id,
    author: raw.author,
    downloads: raw.downloads,
    likes: raw.likes,
    lastModified: raw.lastModified,
    gated: raw.gated ?? false,
    tags: raw.tags,
    description: raw.description ?? null,
    cardData: cardData ? {
      license: cardData.license ?? null,
      language: cardData.language ?? null,
      size_categories: cardData.size_categories ?? null,
      task_categories: cardData.task_categories ?? null,
      dataset_info: cardData.dataset_info ?? null,
    } : null,
    files: siblings?.map(s => s.rfilename) ?? [],
  }
}

async function getSpaces(params: Params, errors: AdapterErrorHelpers) {
  const search = params.search as string | undefined
  if (!search) throw errors.missingParam('search')

  const limit = (params.limit as number | undefined) ?? 20
  const sort = (params.sort as string | undefined) ?? 'likes'
  const direction = (params.direction as number | undefined) ?? -1
  const author = params.author as string | undefined

  const q: Record<string, string | number> = { search, limit, sort, direction }
  if (author) q.author = author

  const raw = await fetchJson(`${API}/spaces${qs(q)}`, errors) as Array<Record<string, unknown>>

  return raw.map(s => ({
    id: s.id,
    author: s.author ?? (s.id as string)?.split('/')[0],
    likes: s.likes,
    sdk: s.sdk ?? null,
    tags: s.tags,
    createdAt: s.createdAt ?? null,
  }))
}

const OPERATIONS: Record<string, (p: Params, e: AdapterErrorHelpers) => Promise<unknown>> = {
  searchModels, getModel, searchDatasets, getDataset, getSpaces,
}

const adapter: CustomRunner = {
  name: 'huggingface',
  description: 'Hugging Face — adapter for all operations with default limits and response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
