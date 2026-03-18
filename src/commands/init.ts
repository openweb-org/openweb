import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { cp, mkdir, readdir, access, rename, rm } from 'node:fs/promises'

const SITES_ROOT = path.join(os.homedir(), '.openweb', 'sites')

/** Verify resolved path stays inside SITES_ROOT. Rejects symlink escapes. */
function safeSitesPath(siteName: string): string {
  const resolved = path.resolve(SITES_ROOT, siteName)
  const resolvedRoot = path.resolve(SITES_ROOT)
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes sites root: ${resolved}`)
  }
  try {
    const real = realpathSync(resolved)
    const realRoot = realpathSync(resolvedRoot)
    if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
      throw new Error(`Symlink escapes sites root: ${real}`)
    }
    return real
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved
    }
    throw err
  }
}

export async function initCommand(): Promise<void> {
  // Seed source: src/fixtures/ relative to dist/cli.js (or src/cli.ts in dev)
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const seedSource = path.resolve(thisDir, '..', 'src', 'fixtures')

  let resolvedSeed = seedSource
  try {
    await access(resolvedSeed)
  } catch {
    // Dev mode: src/commands/init.ts → src/fixtures/
    const altSeed = path.resolve(thisDir, '..', 'fixtures')
    try {
      await access(altSeed)
      resolvedSeed = altSeed
    } catch {
      console.error(`Seed fixtures not found at ${seedSource}`)
      process.exit(1)
    }
  }

  await mkdir(SITES_ROOT, { recursive: true })

  const entries = await readdir(resolvedSeed, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())

  if (dirs.length === 0) {
    console.error(`No fixture directories found in ${resolvedSeed}`)
    process.exit(1)
  }

  let copied = 0
  let skipped = 0

  for (const dir of dirs) {
    const dest = safeSitesPath(dir.name)

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
