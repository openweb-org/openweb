import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, readdir, access } from 'node:fs/promises'

export async function initCommand(): Promise<void> {
  // Seed source: src/fixtures/ relative to dist/cli.js (or src/cli.ts in dev)
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  const seedSource = path.resolve(thisDir, '..', 'src', 'fixtures')

  // Fallback: when running from dist/cli.js, src/fixtures/ is at ../src/fixtures/
  // When running from src/cli.ts (dev), it's at ./fixtures/ — but we resolve from parent
  let resolvedSeed = seedSource
  try {
    await access(resolvedSeed)
  } catch {
    // Try relative to the file's own directory (dev mode: src/commands/init.ts → src/fixtures/)
    const altSeed = path.resolve(thisDir, '..', 'fixtures')
    try {
      await access(altSeed)
      resolvedSeed = altSeed
    } catch {
      console.error(`Seed fixtures not found at ${seedSource}`)
      process.exit(1)
    }
  }

  const target = path.join(os.homedir(), '.openweb', 'sites')
  await mkdir(target, { recursive: true })

  const entries = await readdir(resolvedSeed, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())

  let copied = 0
  let skipped = 0

  for (const dir of dirs) {
    const dest = path.join(target, dir.name)
    try {
      await access(dest)
      skipped++
    } catch {
      await cp(path.join(resolvedSeed, dir.name), dest, { recursive: true })
      copied++
    }
  }

  console.log(`Initialized ${copied + skipped} sites in ${target}`)
  if (copied > 0) console.log(`  Copied: ${copied}`)
  if (skipped > 0) console.log(`  Skipped (already exist): ${skipped}`)
}
