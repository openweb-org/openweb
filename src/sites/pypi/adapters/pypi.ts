import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const PYPI = 'https://pypi.org'

async function fetchJson(url: string, errors: AdapterErrorHelpers, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const { status, text } = await nodeFetch({ url, method: 'GET', headers, timeout: 20_000 })
  if (status === 404) throw errors.apiError('pypi', 'Package or version not found')
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function pickLicense(info: Record<string, unknown>): string | null {
  const expr = info.license_expression as string | null | undefined
  if (expr) return expr
  const raw = info.license as string | null | undefined
  if (!raw) return null
  const firstLine = raw.split('\n')[0].trim()
  if (firstLine.length <= 100) return firstLine
  return firstLine.slice(0, 100)
}

function pickInfo(info: Record<string, unknown>): Record<string, unknown> {
  return {
    name: info.name,
    summary: info.summary,
    version: info.version,
    author: info.author,
    author_email: info.author_email,
    license: pickLicense(info),
    home_page: info.home_page ?? (info.project_urls as Record<string, string> | null)?.Homepage
      ?? (info.project_urls as Record<string, string> | null)?.homepage ?? null,
    package_url: info.package_url,
    project_urls: info.project_urls,
    requires_python: info.requires_python,
    requires_dist: info.requires_dist,
    keywords: info.keywords,
    classifiers: info.classifiers,
  }
}

async function getPackage(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const pkg = params.package as string | undefined
  if (!pkg) throw errors.missingParam('package')

  const doc = await fetchJson(`${PYPI}/pypi/${encodeURIComponent(pkg)}/json`, errors)
  return pickInfo(doc.info as Record<string, unknown>)
}

async function getPackageVersion(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const pkg = params.package as string | undefined
  if (!pkg) throw errors.missingParam('package')
  const version = params.version as string | undefined
  if (!version) throw errors.missingParam('version')

  const doc = await fetchJson(`${PYPI}/pypi/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}/json`, errors)
  const result = pickInfo(doc.info as Record<string, unknown>)

  const urls = doc.urls as Array<Record<string, unknown>> | undefined
  if (urls?.length) {
    ;(result as Record<string, unknown>).upload_time = urls[0].upload_time ?? null
  }
  return result
}

function summarizeReleaseFiles(files: ReadonlyArray<Record<string, unknown>>): {
  requires_python: string | null
  yanked: boolean
  yanked_reason: string | null
  upload_time: string | null
} {
  let requires_python: string | null = null
  let yanked = false
  let yanked_reason: string | null = null
  let upload_time: string | null = null
  for (const f of files) {
    if (requires_python === null && typeof f.requires_python === 'string') {
      requires_python = f.requires_python
    }
    if (f.yanked === true || (typeof f.yanked === 'string' && f.yanked.length > 0)) {
      yanked = true
      const reason = (f.yanked_reason as string | null | undefined)
        ?? (typeof f.yanked === 'string' ? f.yanked : null)
      if (reason && !yanked_reason) yanked_reason = reason
    }
    if (upload_time === null && typeof f.upload_time === 'string') {
      upload_time = f.upload_time
    }
  }
  return { requires_python, yanked, yanked_reason, upload_time }
}

async function getReleases(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const pkg = params.package as string | undefined
  if (!pkg) throw errors.missingParam('package')

  const doc = await fetchJson(`${PYPI}/pypi/${encodeURIComponent(pkg)}/json`, errors)
  const info = (doc.info ?? {}) as Record<string, unknown>
  const releases = (doc.releases ?? {}) as Record<string, Array<Record<string, unknown>>>

  const versions = Object.entries(releases).map(([version, files]) => ({
    version,
    ...summarizeReleaseFiles(files ?? []),
  }))

  return {
    name: info.name ?? pkg,
    requires_dist: info.requires_dist ?? null,
    classifiers: info.classifiers ?? null,
    versions,
  }
}

const adapter: CustomRunner = {
  name: 'pypi',
  description: 'PyPI — curated package metadata with response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    switch (operation) {
      case 'getPackage': return getPackage(params, helpers.errors)
      case 'getPackageVersion': return getPackageVersion(params, helpers.errors)
      case 'getReleases': return getReleases(params, helpers.errors)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
