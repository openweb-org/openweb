import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { cp, mkdir, readdir, access, rename, rm } from 'node:fs/promises'

const SITES_ROOT = path.join(os.homedir(), '.openweb', 'sites')

/** Verify resolved path stays inside canonical SITES_ROOT. Rejects symlink escapes. */
function safeSitesPath(canonicalRoot: string, siteName: string): string {
  // Build child from already-canonicalized root — no symlink on parent can fool us
  const resolved = path.join(canonicalRoot, siteName)
  if (!resolved.startsWith(canonicalRoot + path.sep)) {
    throw new Error(`Path escapes sites root: ${resolved}`)
  }
  return resolved
}

export async function initCommand(): Promise<void> {
  // Seed source: src/sites/ relative to dist/cli.js (or src/cli.ts in dev)
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const seedSource = path.resolve(thisDir, '..', 'src', 'sites')

  let resolvedSeed = seedSource
  try {
    await access(resolvedSeed)
  } catch {
    // Dev mode: src/commands/init.ts → src/sites/
    const altSeed = path.resolve(thisDir, '..', 'sites')
    try {
      await access(altSeed)
      resolvedSeed = altSeed
    } catch {
      console.error(`Seed sites not found at ${seedSource}`)
      process.exit(1)
    }
  }

  await mkdir(SITES_ROOT, { recursive: true })
  // Canonicalize after mkdir so symlinks in the parent chain are resolved
  const canonicalRoot = realpathSync(SITES_ROOT)

  const entries = await readdir(resolvedSeed, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())

  if (dirs.length === 0) {
    console.error(`No site directories found in ${resolvedSeed}`)
    process.exit(1)
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
      await rm(tmpDest, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  console.log(`Initialized ${copied + skipped} sites in ${SITES_ROOT}`)
  if (copied > 0) console.log(`  Copied: ${copied}`)
  if (skipped > 0) console.log(`  Skipped (already exist): ${skipped}`)
}
