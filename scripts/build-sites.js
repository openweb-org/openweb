#!/usr/bin/env node
/**
 * Copy runtime site assets to dist/sites/<name>/ for npm packaging.
 * Runs AFTER tsup + build-adapters so compiled .js adapters exist.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const sitesDir = path.join(process.cwd(), 'src', 'sites')
const outDir = path.join(process.cwd(), 'dist', 'sites')

if (!existsSync(sitesDir)) {
  console.log('No sites directory found, skipping site packaging.')
  process.exit(0)
}

const sites = readdirSync(sitesDir, { withFileTypes: true }).filter((d) =>
  d.isDirectory(),
)

let copied = 0

for (const site of sites) {
  const srcSite = path.join(sitesDir, site.name)
  const dstSite = path.join(outDir, site.name)

  // Top-level files to copy
  const topFiles = ['openapi.yaml', 'manifest.json', 'DOC.md', 'PROGRESS.md']
  const filesToCopy = topFiles.filter((f) => existsSync(path.join(srcSite, f)))

  // Check for compiled .js adapters
  const adapterDir = path.join(srcSite, 'adapters')
  const hasAdapters =
    existsSync(adapterDir) &&
    readdirSync(adapterDir).some((f) => f.endsWith('.js'))

  if (filesToCopy.length === 0 && !hasAdapters) continue

  mkdirSync(dstSite, { recursive: true })

  for (const file of filesToCopy) {
    cpSync(path.join(srcSite, file), path.join(dstSite, file))
    copied++
  }

  if (hasAdapters) {
    const dstAdapters = path.join(dstSite, 'adapters')
    mkdirSync(dstAdapters, { recursive: true })
    for (const f of readdirSync(adapterDir)) {
      if (!f.endsWith('.js')) continue
      cpSync(path.join(adapterDir, f), path.join(dstAdapters, f))
      copied++
    }
  }

  // Copy test files
  const testsDir = path.join(srcSite, 'tests')
  if (existsSync(testsDir)) {
    const dstTests = path.join(dstSite, 'tests')
    mkdirSync(dstTests, { recursive: true })
    for (const f of readdirSync(testsDir)) {
      if (!f.endsWith('.test.json')) continue
      cpSync(path.join(testsDir, f), path.join(dstTests, f))
      copied++
    }
  }

  console.log(`  ${site.name}/`)
}

console.log(`Packaged ${String(sites.length)} site(s), ${String(copied)} file(s) copied to dist/sites/`)
