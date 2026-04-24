import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://hub.docker.com'

function splitImage(
  params: Readonly<Record<string, unknown>>,
  errors: AdapterErrorHelpers,
): { namespace: string; name: string } {
  const image = params.image as string | undefined
  if (image) {
    const slash = image.indexOf('/')
    if (slash === -1) return { namespace: 'library', name: image }
    return { namespace: image.slice(0, slash), name: image.slice(slash + 1) }
  }
  const namespace = params.namespace as string | undefined
  const name = params.name as string | undefined
  if (!namespace || !name) throw errors.missingParam('image')
  return { namespace, name }
}

async function fetchJson(url: string, errors: AdapterErrorHelpers): Promise<Record<string, unknown>> {
  const { status, text } = await nodeFetch({ url, method: 'GET', headers: { Accept: 'application/json' }, timeout: 20_000 })
  if (status === 404) throw errors.apiError('docker-hub', 'Repository not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function searchImages(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const query = params.query as string | undefined
  if (!query) throw errors.missingParam('query')
  const pageSize = (params.page_size as number | undefined) ?? 25
  const page = (params.page as number | undefined) ?? 1

  const url = `${API}/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=${pageSize}&page=${page}`
  const data = await fetchJson(url, errors)
  const results = (data.results as Array<Record<string, unknown>>) ?? []

  return {
    count: data.count,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: results.map(r => ({
      repo_name: r.repo_name,
      short_description: r.short_description,
      star_count: r.star_count,
      pull_count: r.pull_count,
      is_official: r.is_official,
      is_automated: r.is_automated,
    })),
  }
}

async function getImage(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const { namespace, name } = splitImage(params, errors)
  const data = await fetchJson(`${API}/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`, errors)

  const fullDesc = data.full_description as string | null | undefined
  const descPreview = fullDesc && fullDesc.length > 500 ? fullDesc.slice(0, 500) + '…' : fullDesc

  return {
    name: data.name,
    namespace: data.namespace,
    description: data.description,
    full_description_preview: descPreview,
    star_count: data.star_count,
    pull_count: data.pull_count,
    last_updated: data.last_updated,
    date_registered: data.date_registered,
    is_private: data.is_private,
    is_official: data.namespace === 'library',
    repository_type: data.repository_type,
    content_types: data.content_types,
    categories: (data.categories as Array<Record<string, unknown>> | undefined)?.map(c => c.name),
  }
}

async function getTags(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const { namespace, name } = splitImage(params, errors)
  const pageSize = (params.page_size as number | undefined) ?? 10
  const page = (params.page as number | undefined) ?? 1
  const ordering = (params.ordering as string | undefined) ?? ''

  let url = `${API}/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags/?page_size=${pageSize}&page=${page}`
  if (ordering) url += `&ordering=${encodeURIComponent(ordering)}`

  const data = await fetchJson(url, errors)
  const results = (data.results as Array<Record<string, unknown>>) ?? []

  return {
    count: data.count,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: results.map(t => {
      const images = (t.images as Array<Record<string, unknown>>) ?? []
      const architectures = [...new Set(images.map(i => `${i.os}/${i.architecture}`))].sort()
      const fullSize = t.full_size as number | undefined

      return {
        name: t.name,
        size: fullSize ? formatBytes(fullSize) : null,
        size_bytes: fullSize ?? null,
        last_updated: t.last_updated,
        tag_status: t.tag_status,
        tag_last_pushed: t.tag_last_pushed,
        digest: t.digest,
        architectures,
        platform_count: images.length,
      }
    }),
  }
}

const OPERATIONS: Record<
  string,
  (params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers) => Promise<unknown>
> = { searchImages, getImage, getTags }

const adapter: CustomRunner = {
  name: 'docker-hub',
  description: 'Docker Hub — response trimming (description, tag platforms) and image param splitting',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
