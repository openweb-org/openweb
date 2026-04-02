#!/usr/bin/env node
/**
 * Copy runtime site assets to dist/sites/<name>/ for npm packaging.
 * Runs AFTER tsup + build-adapters so compiled .js adapters exist.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sitesDir = path.join(process.cwd(), 'src', 'sites')
const outDir = path.join(process.cwd(), 'dist', 'sites')

/** Sites excluded from build output (WIP / dropped — kept in src/ only). */
const EXCLUDED_SITES = new Set([
  'bitbucket',
  'coinbase',
  'coingecko',
  'digital',
  'finance',
  'httpbin',
  'jsonplaceholder',
  'microsoft-word',
  'npm',
  'open-meteo',
  'pokeapi',
  'stackoverflow',
  'tiktok',
  'yelp',
  'zillow',
])

if (!existsSync(sitesDir)) {
  console.log('No sites directory found, skipping site packaging.')
  process.exit(0)
}

const sites = readdirSync(sitesDir, { withFileTypes: true }).filter(
  (d) => d.isDirectory() && !EXCLUDED_SITES.has(d.name),
)

// Clean stale dist/sites/ so excluded sites don't linger across builds
if (existsSync(outDir)) rmSync(outDir, { recursive: true })

let copied = 0

for (const site of sites) {
  const srcSite = path.join(sitesDir, site.name)
  const dstSite = path.join(outDir, site.name)

  // Top-level files to copy
  const topFiles = ['openapi.yaml', 'asyncapi.yaml', 'manifest.json', 'DOC.md', 'PROGRESS.md']
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

  // Copy example files
  const examplesDir = path.join(srcSite, 'examples')
  if (existsSync(examplesDir)) {
    const dstExamples = path.join(dstSite, 'examples')
    mkdirSync(dstExamples, { recursive: true })
    for (const f of readdirSync(examplesDir)) {
      if (!f.endsWith('.example.json')) continue
      cpSync(path.join(examplesDir, f), path.join(dstExamples, f))
      copied++
    }
  }

  console.log(`  ${site.name}/`)
}

console.log(`Packaged ${String(sites.length)} site(s), ${String(copied)} file(s) copied to dist/sites/`)

// Sync dist/sites/ → ~/.openweb/sites/ so that CLI cache stays up-to-date
// with the source tree after build.
const cacheDir = path.join(os.homedir(), '.openweb', 'sites')
if (existsSync(outDir)) {
  // Remove excluded sites from cache if they linger from previous builds
  for (const name of EXCLUDED_SITES) {
    const stale = path.join(cacheDir, name)
    if (existsSync(stale)) rmSync(stale, { recursive: true })
  }

  let synced = 0
  for (const site of readdirSync(outDir, { withFileTypes: true })) {
    if (!site.isDirectory()) continue
    const src = path.join(outDir, site.name)
    const dst = path.join(cacheDir, site.name)
    // Clean sync: delete stale cache dir first, then copy fresh
    if (existsSync(dst)) rmSync(dst, { recursive: true })
    mkdirSync(dst, { recursive: true })
    cpSync(src, dst, { recursive: true })
    synced++
  }

  // Remove cache entries that don't exist in dist (stale compile artifacts)
  if (existsSync(cacheDir)) {
    const distNames = new Set(readdirSync(outDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name))
    for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !distNames.has(entry.name)) {
        rmSync(path.join(cacheDir, entry.name), { recursive: true })
      }
    }
  }

  if (synced > 0) {
    console.log(`Synced ${String(synced)} site(s) to ${cacheDir}`)
  }
}
