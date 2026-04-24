import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const REGISTRY = 'https://registry.npmjs.org'

async function fetchRegistry(pkg: string, errors: AdapterErrorHelpers): Promise<Record<string, unknown>> {
  const { status, text } = await nodeFetch({
    url: `${REGISTRY}/${encodeURIComponent(pkg).replace('%40', '@')}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeout: 20_000,
  })
  if (status === 404) throw errors.apiError('npm', `Package "${pkg}" not found`)
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

async function getPackage(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const pkg = params.package as string | undefined
  if (!pkg) throw errors.missingParam('package')

  const doc = await fetchRegistry(pkg, errors)
  const distTags = doc['dist-tags'] as Record<string, string> | undefined
  const latestVersion = distTags?.latest
  const versions = doc.versions as Record<string, Record<string, unknown>> | undefined
  const latestManifest = latestVersion && versions ? versions[latestVersion] : undefined
  const time = doc.time as Record<string, string> | undefined

  return {
    name: doc.name,
    description: doc.description,
    'dist-tags': distTags,
    license: latestManifest?.license ?? doc.license,
    homepage: doc.homepage,
    repository: doc.repository,
    maintainers: doc.maintainers,
    lastModified: time?.modified,
    lastPublished: latestVersion && time ? time[latestVersion] : undefined,
    latest: latestVersion
      ? {
          version: latestVersion,
          dependencies: latestManifest?.dependencies,
          devDependencies: latestManifest?.devDependencies,
          engines: latestManifest?.engines,
          dist: latestManifest?.dist
            ? { tarball: (latestManifest.dist as Record<string, unknown>).tarball, shasum: (latestManifest.dist as Record<string, unknown>).shasum }
            : undefined,
        }
      : undefined,
    versionCount: versions ? Object.keys(versions).length : undefined,
  }
}

async function getVersions(params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers): Promise<unknown> {
  const pkg = params.package as string | undefined
  if (!pkg) throw errors.missingParam('package')

  const doc = await fetchRegistry(pkg, errors)
  const time = doc.time as Record<string, string> | undefined
  if (!time) throw errors.apiError('npm', 'No version history available')

  const entries: Array<{ version: string; date: string }> = []
  for (const [key, date] of Object.entries(time)) {
    if (key === 'created' || key === 'modified') continue
    entries.push({ version: key, date })
  }
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    name: doc.name,
    'dist-tags': doc['dist-tags'],
    created: time.created,
    modified: time.modified,
    versionCount: entries.length,
    versions: entries,
  }
}

const OPERATIONS: Record<
  string,
  (params: Readonly<Record<string, unknown>>, errors: AdapterErrorHelpers) => Promise<unknown>
> = { getPackage, getVersions }

const adapter: CustomRunner = {
  name: 'npm',
  description: 'npm registry — adapter for getPackage (summary) and getVersions (time field extraction)',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
