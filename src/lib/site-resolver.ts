import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access, readdir, readFile } from 'node:fs/promises'

import { openwebHome } from './config.js'
import { OpenWebError } from './errors.js'
import { logger } from './logger.js'

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    // intentional: existence check — ENOENT is expected
    return false
  }
}

/** A site dir is valid if it contains manifest.json, openapi.yaml, or asyncapi.yaml. */
async function hasSitePackage(dir: string): Promise<boolean> {
  return (
    await pathExists(path.join(dir, 'manifest.json')) ||
    await pathExists(path.join(dir, 'openapi.yaml')) ||
    await pathExists(path.join(dir, 'asyncapi.yaml'))
  )
}

/** Site names must be lowercase alphanumeric with hyphens/underscores. */
const SAFE_SITE_NAME = /^[a-z0-9][a-z0-9_-]*$/

/** Package root — two levels up from dist/lib/openapi.js (or src/lib/openapi.ts in dev). */
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Bundled sites shipped inside the npm package. */
const BUNDLED_SITES = path.join(PKG_ROOT, 'dist', 'sites')

export interface ResolveSiteOptions {
  /** Skip registry lookup — use when installing to avoid self-copy. */
  readonly skipRegistry?: boolean
}

export async function resolveSiteRoot(site: string, opts?: ResolveSiteOptions): Promise<string> {
  if (!SAFE_SITE_NAME.test(site)) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: `Invalid site name: ${site}`,
      action: 'Site names must be lowercase alphanumeric with hyphens/underscores.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // 1. ~/.openweb/sites/ — user-installed (primary)
  const userSite = path.join(openwebHome(), 'sites', site)
  if (await hasSitePackage(userSite)) {
    return userSite
  }

  // 2. Registry (versioned sites)
  if (!opts?.skipRegistry) {
    const registryCurrentFile = path.join(openwebHome(), 'registry', site, 'current')
    try {
      const currentVersion = (await readFile(registryCurrentFile, 'utf8')).trim()
      if (/^\d+\.\d+\.\d+$/.test(currentVersion)) {
        const registryVersionPath = path.join(openwebHome(), 'registry', site, currentVersion)
        if (await hasSitePackage(registryVersionPath)) {
          return registryVersionPath
        }
      }
    } catch { /* no registry entry — fall through */ }
  }

  // 3. Bundled sites shipped with the package (dist/sites/)
  const bundledSite = path.join(BUNDLED_SITES, site)
  if (await hasSitePackage(bundledSite)) {
    return bundledSite
  }

  // 4. ./src/sites/ — dev fallback
  const devSite = path.join(process.cwd(), 'src', 'sites', site)
  if (await hasSitePackage(devSite)) {
    return devSite
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'TOOL_NOT_FOUND',
    message: `Site not found: ${site}`,
    action: 'Run `openweb sites` to list available sites.',
    retriable: false,
    failureClass: 'fatal',
  })
}

export async function listSites(): Promise<string[]> {
  const roots = [
    path.join(openwebHome(), 'sites'),
    path.join(openwebHome(), 'registry'),
    BUNDLED_SITES,
    path.join(process.cwd(), 'src', 'sites'),
  ]

  const names = new Set<string>()

  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        // Registry entries have version subdirs — check for `current` file
        if (root.endsWith('registry')) {
          const currentFile = path.join(root, entry.name, 'current')
          if (await pathExists(currentFile)) {
            names.add(entry.name)
          }
          continue
        }
        const candidate = path.join(root, entry.name)
        if (await hasSitePackage(candidate)) {
          names.add(entry.name)
        }
      }
    } catch (err) {
      logger.debug(`site directory listing failed for ${root}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return Array.from(names).sort()
}
