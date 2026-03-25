import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { cp, mkdir, readdir, access, rename, rm } from 'node:fs/promises'

import { OpenWebError } from '../lib/errors.js'

const SITES_ROOT = path.join(os.homedir(), '.openweb', 'sites')

/** Verify resolved path stays inside canonical SITES_ROOT. Rejects symlink escapes. */
function safeSitesPath(canonicalRoot: string, siteName: string): string {
  // Build child from already-canonicalized root — no symlink on parent can fool us
  const resolved = path.join(canonicalRoot, siteName)
  if (!resolved.startsWith(canonicalRoot + path.sep)) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Path escapes sites root: ${resolved}`,
      action: 'Use a valid site name that does not traverse directories.',
      retriable: false, failureClass: 'fatal',
    })
  }
  return resolved
}

export async function initCommand(): Promise<void> {
  // Seed source: prefer dist/sites/ (bundled), fall back to src/sites/ (dev)
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const pkgRoot = path.resolve(thisDir, '..', '..')
  const candidates = [
    path.join(pkgRoot, 'dist', 'sites'),
    path.join(pkgRoot, 'src', 'sites'),
  ]

  let resolvedSeed: string | undefined
  for (const candidate of candidates) {
    try {
      await access(candidate)
      resolvedSeed = candidate
      break
    } catch { /* intentional: try next candidate directory */ }
  }

  if (!resolvedSeed) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `Seed sites not found (checked ${candidates.join(', ')})`,
      action: 'Ensure the package is installed correctly.',
      retriable: false, failureClass: 'fatal',
    })
  }

  await mkdir(SITES_ROOT, { recursive: true })
  // Canonicalize after mkdir so symlinks in the parent chain are resolved
  const canonicalRoot = realpathSync(SITES_ROOT)

  const entries = await readdir(resolvedSeed, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())

  if (dirs.length === 0) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: `No site directories found in ${resolvedSeed}`,
      action: 'Ensure the seed directory contains site subdirectories.',
      retriable: false, failureClass: 'fatal',
    })
  }

  let copied = 0
  let skipped = 0

  for (const dir of dirs) {
    const dest = safeSitesPath(canonicalRoot, dir.name)

    // Skip only when dest has a valid openapi.yaml (not just any directory)
    try {
      await access(path.join(dest, 'openapi.yaml'))
      skipped++
      continue
    } catch { /* dest missing or incomplete — copy */ }

    // Atomic copy: write to temp dir, then rename into place
    const tmpDest = `${dest}.tmp.${process.pid}`
    try {
      await rm(tmpDest, { recursive: true, force: true })
      await cp(path.join(resolvedSeed, dir.name), tmpDest, { recursive: true })
      // Remove incomplete dest (no openapi.yaml) before rename to avoid ENOTEMPTY
      await rm(dest, { recursive: true, force: true })
      await rename(tmpDest, dest)
      copied++
    } catch (err) {
      await rm(tmpDest, { recursive: true, force: true }).catch(() => {}) // intentional: best-effort cleanup on copy failure
      throw err
    }
  }

  process.stdout.write(`Localized ${copied + skipped} sites to ${SITES_ROOT}\n`)
  if (copied > 0) process.stdout.write(`  Copied: ${copied}\n`)
  if (skipped > 0) process.stdout.write(`  Skipped (already exist): ${skipped}\n`)
}
