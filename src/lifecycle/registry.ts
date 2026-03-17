import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises'

import type { Manifest } from '../types/manifest.js'
import { resolveSiteRoot } from '../lib/openapi.js'

const REGISTRY_ROOT = path.join(os.homedir(), '.openweb', 'registry')
const MAX_VERSIONS = 5

function registrySitePath(site: string): string {
  return path.join(REGISTRY_ROOT, site)
}

function registryVersionPath(site: string, version: string): string {
  return path.join(REGISTRY_ROOT, site, version)
}

function currentFilePath(site: string): string {
  return path.join(REGISTRY_ROOT, site, 'current')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(p)
    return true
  } catch {
    return false
  }
}

async function loadManifestFrom(dir: string): Promise<Manifest | undefined> {
  try {
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return undefined
  }
}

/**
 * List all archived versions for a site, sorted by semver ascending.
 */
export async function listVersions(site: string): Promise<string[]> {
  const siteDir = registrySitePath(site)
  if (!(await pathExists(siteDir))) return []

  const entries = await readdir(siteDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name)
    .sort(compareSemver)
}

/**
 * Get the currently active version for a site in the registry.
 */
export async function getCurrentVersion(site: string): Promise<string | undefined> {
  try {
    return (await readFile(currentFilePath(site), 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Set the current version for a site.
 */
export async function setCurrentVersion(site: string, version: string): Promise<void> {
  await writeFile(currentFilePath(site), version, 'utf8')
}

/**
 * Archive a site fixture to the registry.
 * Copies the entire fixture directory to registry/<site>/<version>/.
 * Returns the archived version string.
 */
export async function archiveSite(site: string, siteRoot?: string): Promise<string> {
  const source = siteRoot ?? (await resolveSiteRoot(site))
  const manifest = await loadManifestFrom(source)
  const version = manifest?.version ?? '1.0.0'

  const dest = registryVersionPath(site, version)
  await mkdir(dest, { recursive: true })

  // Copy entire fixture
  await cp(source, dest, { recursive: true, force: true })

  // Set as current
  await setCurrentVersion(site, version)

  // Prune old versions
  await pruneSite(site, MAX_VERSIONS)

  return version
}

/**
 * Bump the minor version of a site manifest.
 * Returns the new version string.
 */
export function bumpMinor(version: string): string {
  const parts = version.split('.')
  const major = parts[0] ?? '1'
  const minor = Number(parts[1] ?? '0') + 1
  return `${major}.${minor}.0`
}

/**
 * Archive with a version bump (for drift scenarios).
 * Bumps minor version, copies to registry, then updates source manifest.
 * Idempotent: won't bump if the same version already exists in registry.
 */
export async function archiveWithBump(site: string, siteRoot?: string): Promise<string> {
  const source = siteRoot ?? (await resolveSiteRoot(site))
  const manifest = await loadManifestFrom(source)
  if (!manifest) return archiveSite(site, source)

  const newVersion = bumpMinor(manifest.version)

  // Idempotent: if this version already exists, skip
  const existing = await listVersions(site)
  if (existing.includes(newVersion)) return newVersion

  // Copy to registry first, then update the copy's manifest (not source)
  const dest = registryVersionPath(site, newVersion)
  await mkdir(dest, { recursive: true })
  await cp(source, dest, { recursive: true, force: true })

  // Update manifest in the registry copy only
  const updated = { ...manifest, version: newVersion }
  await writeFile(path.join(dest, 'manifest.json'), `${JSON.stringify(updated, null, 2)}\n`, 'utf8')

  await setCurrentVersion(site, newVersion)
  await pruneSite(site, MAX_VERSIONS)

  return newVersion
}

/**
 * Rollback to the previous version. Returns the rolled-back version.
 */
export async function rollbackSite(site: string): Promise<string> {
  const versions = await listVersions(site)
  const current = await getCurrentVersion(site)

  if (versions.length < 2) {
    throw new Error(`No previous version to rollback to for ${site}`)
  }

  const currentIdx = current ? versions.indexOf(current) : versions.length - 1
  if (currentIdx <= 0) {
    throw new Error(`Already at oldest version (${versions[0]}) for ${site}`)
  }

  const previousVersion = versions[currentIdx - 1]!
  await setCurrentVersion(site, previousVersion)
  return previousVersion
}

/**
 * Prune old versions, keeping the most recent `keep` versions.
 */
export async function pruneSite(site: string, keep: number = MAX_VERSIONS): Promise<void> {
  const versions = await listVersions(site)
  if (versions.length <= keep) return

  const toRemove = versions.slice(0, versions.length - keep)
  for (const version of toRemove) {
    await rm(registryVersionPath(site, version), { recursive: true, force: true })
  }
}

/**
 * List all sites in the registry with their current version.
 */
export async function listRegisteredSites(): Promise<Array<{ site: string; version: string | undefined; versions: string[] }>> {
  if (!(await pathExists(REGISTRY_ROOT))) return []

  const entries = await readdir(REGISTRY_ROOT, { withFileTypes: true })
  const results: Array<{ site: string; version: string | undefined; versions: string[] }> = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const versions = await listVersions(entry.name)
    if (versions.length === 0) continue
    const current = await getCurrentVersion(entry.name)
    results.push({ site: entry.name, version: current, versions })
  }

  return results.sort((a, b) => a.site.localeCompare(b.site))
}

/**
 * Get the path to the current active version of a registered site.
 * Returns undefined if the site is not in the registry.
 */
export async function getRegistryCurrentPath(site: string): Promise<string | undefined> {
  const current = await getCurrentVersion(site)
  if (!current) return undefined
  const versionPath = registryVersionPath(site, current)
  if (!(await pathExists(path.join(versionPath, 'openapi.yaml')))) return undefined
  return versionPath
}

// ── Semver comparison ──────────────────────────────

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
