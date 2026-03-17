import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, readdir, mkdir, cp, rm, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'

import type { Manifest } from '../types/manifest.js'
import { resolveSiteRoot } from '../lib/openapi.js'

const REGISTRY_ROOT = path.join(os.homedir(), '.openweb', 'registry')
const MAX_VERSIONS = 5

/** Alphanumeric, hyphens, dots only. No empty, no '..' components. */
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

function validatePathComponent(value: string, label: string): void {
  if (!SAFE_NAME.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

/** Resolve and verify a path stays inside REGISTRY_ROOT. Resolves symlinks. */
function safeRegistryPath(...segments: string[]): string {
  for (const seg of segments) {
    validatePathComponent(seg, 'path component')
  }
  const resolved = path.resolve(REGISTRY_ROOT, ...segments)
  const resolvedRoot = path.resolve(REGISTRY_ROOT)
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Path escapes registry root: ${resolved}`)
  }
  // Resolve symlinks if the path exists on disk
  try {
    const real = realpathSync(resolved)
    const realRoot = realpathSync(resolvedRoot)
    if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
      throw new Error(`Symlink escapes registry root: ${real}`)
    }
    return real
  } catch (err) {
    // ENOENT = path doesn't exist yet (pre-creation), that's fine — string check passed
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved
    }
    throw err
  }
}

function registrySitePath(site: string): string {
  return safeRegistryPath(site)
}

function registryVersionPath(site: string, version: string): string {
  return safeRegistryPath(site, version)
}

function currentFilePath(site: string): string {
  return path.join(safeRegistryPath(site), 'current')
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

async function mkdirSecure(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

async function writeFileSecure(filePath: string, data: string): Promise<void> {
  await writeFile(filePath, data, { encoding: 'utf8', mode: 0o600 })
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
    const version = (await readFile(currentFilePath(site), 'utf8')).trim()
    validatePathComponent(version, 'version')
    return version
  } catch {
    return undefined
  }
}

/**
 * Set the current version for a site.
 */
export async function setCurrentVersion(site: string, version: string): Promise<void> {
  validatePathComponent(version, 'version')
  await writeFileSecure(currentFilePath(site), version)
}

/**
 * Archive a site fixture to the registry.
 * Copies the entire fixture directory to registry/<site>/<version>/.
 * Returns the archived version string.
 */
export async function archiveSite(site: string, siteRoot?: string): Promise<string> {
  const source = siteRoot ?? (await resolveSiteRoot(site, { skipRegistry: true }))
  const manifest = await loadManifestFrom(source)
  const version = manifest?.version ?? '1.0.0'
  validatePathComponent(version, 'version')

  const dest = registryVersionPath(site, version)
  await mkdirSecure(dest)

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
 * Bumps minor version, copies to registry, then updates the registry copy's manifest.
 * Idempotent: won't bump if the same version already exists in registry.
 */
export async function archiveWithBump(site: string, siteRoot?: string): Promise<string> {
  const source = siteRoot ?? (await resolveSiteRoot(site, { skipRegistry: true }))
  const manifest = await loadManifestFrom(source)
  if (!manifest) return archiveSite(site, source)

  const newVersion = bumpMinor(manifest.version)
  validatePathComponent(newVersion, 'version')

  // Idempotent: if this version already exists, skip
  const existing = await listVersions(site)
  if (existing.includes(newVersion)) return newVersion

  // Copy to registry first, then update the copy's manifest (not source)
  const dest = registryVersionPath(site, newVersion)
  await mkdirSecure(dest)
  await cp(source, dest, { recursive: true, force: true })

  // Update manifest in the registry copy only
  const updated = { ...manifest, version: newVersion }
  await writeFileSecure(path.join(dest, 'manifest.json'), `${JSON.stringify(updated, null, 2)}\n`)

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
    if (!SAFE_NAME.test(entry.name)) continue
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
  if (!SAFE_NAME.test(site)) return undefined
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
