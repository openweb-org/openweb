#!/usr/bin/env node
/**
 * Compile .ts adapter files to .js for production use.
 * In dev mode (tsx), .ts files are imported directly.
 * In built mode (node dist/cli.js), only .js files work.
 */
import { execSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const fixturesDir = path.join(process.cwd(), 'src', 'fixtures')

if (!existsSync(fixturesDir)) {
  console.log('No fixtures directory found, skipping adapter build.')
  process.exit(0)
}

const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())

let compiled = 0
for (const fixture of fixtures) {
  const adapterDir = path.join(fixturesDir, fixture.name, 'adapters')
  if (!existsSync(adapterDir)) continue

  const tsFiles = readdirSync(adapterDir).filter((f) => f.endsWith('.ts'))
  for (const tsFile of tsFiles) {
    const input = path.join(adapterDir, tsFile)
    const output = path.join(adapterDir, tsFile.replace(/\.ts$/, '.js'))
    try {
      execSync(`npx esbuild "${input}" --outfile="${output}" --format=esm --platform=node --target=es2022`, {
        stdio: 'pipe',
      })
      compiled++
    } catch (err) {
      console.error(`Failed to compile ${input}:`, err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }
}

if (compiled > 0) {
  console.log(`Compiled ${String(compiled)} adapter(s) to .js`)
}
