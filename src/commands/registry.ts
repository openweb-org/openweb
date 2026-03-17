import {
  listRegisteredSites,
  archiveSite,
  rollbackSite,
  listVersions,
  getCurrentVersion,
} from '../lifecycle/registry.js'
import { resolveSiteRoot } from '../lib/openapi.js'

export type RegistryAction = 'list' | 'install' | 'rollback' | 'show'

export interface RegistryCommandOptions {
  readonly action: RegistryAction
  readonly site?: string
}

export async function registryCommand(opts: RegistryCommandOptions): Promise<void> {
  switch (opts.action) {
    case 'list':
      return registryList()
    case 'install':
      if (!opts.site) {
        process.stderr.write('Usage: openweb registry install <site>\n')
        process.exit(1)
      }
      return registryInstall(opts.site)
    case 'rollback':
      if (!opts.site) {
        process.stderr.write('Usage: openweb registry rollback <site>\n')
        process.exit(1)
      }
      return registryRollback(opts.site)
    case 'show':
      if (!opts.site) {
        process.stderr.write('Usage: openweb registry show <site>\n')
        process.exit(1)
      }
      return registryShow(opts.site)
  }
}

async function registryList(): Promise<void> {
  const sites = await listRegisteredSites()
  if (sites.length === 0) {
    process.stdout.write('No sites in registry.\n')
    return
  }

  for (const entry of sites) {
    const current = entry.version ?? 'unknown'
    const count = entry.versions.length
    process.stdout.write(`${entry.site}  v${current}  (${count} version${count === 1 ? '' : 's'})\n`)
  }
}

async function registryInstall(site: string): Promise<void> {
  const siteRoot = await resolveSiteRoot(site, { skipRegistry: true })
  const version = await archiveSite(site, siteRoot)
  process.stdout.write(`Installed ${site} v${version} to registry.\n`)
}

async function registryRollback(site: string): Promise<void> {
  try {
    const version = await rollbackSite(site)
    process.stdout.write(`Rolled back ${site} to v${version}.\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

async function registryShow(site: string): Promise<void> {
  const versions = await listVersions(site)
  const current = await getCurrentVersion(site)

  if (versions.length === 0) {
    process.stdout.write(`No versions found for ${site} in registry.\n`)
    return
  }

  process.stdout.write(`${site} — ${versions.length} version(s)\n`)
  for (const v of [...versions].reverse()) {
    const marker = v === current ? ' (current)' : ''
    process.stdout.write(`  v${v}${marker}\n`)
  }
}
