#!/usr/bin/env node
// Verify npm tarball contains only expected files.
// Called by prepublishOnly via `pnpm pack:check`.

import { execSync } from 'node:child_process'

const output = execSync('npm pack --dry-run 2>&1', { encoding: 'utf8' })
const lines = output.split('\n').filter(l => l.startsWith('npm notice') && !l.includes('Tarball') && !l.includes('shasum') && !l.includes('integrity') && !l.includes('total files') && !l.includes('📦'))

const files = lines
  .map(l => l.replace(/^npm notice\s+[\d.]+[kMG]?B?\s+/, '').trim())
  .filter(f => f && !f.startsWith('='))

const forbidden = ['.ts', 'src/', 'tests/', 'capture/', 'node_modules/', '.env']
const violations = []

for (const f of files) {
  // Allow .d.ts type declarations
  if (f.endsWith('.d.ts')) continue
  for (const pat of forbidden) {
    if (f.includes(pat)) violations.push(f)
  }
}

if (violations.length > 0) {
  console.error('Pack check FAILED — forbidden files in tarball:')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}

// Check size
const sizeMatch = output.match(/Tarball Size:\s*([\d.]+)\s*([kMG]B)/)
if (sizeMatch) {
  const size = Number.parseFloat(sizeMatch[1])
  const unit = sizeMatch[2]
  const bytes = unit === 'kB' ? size * 1024 : unit === 'MB' ? size * 1024 * 1024 : size * 1024 * 1024 * 1024
  if (bytes > 5 * 1024 * 1024) {
    console.error(`Pack check FAILED — tarball too large: ${size}${unit} (max 5MB)`)
    process.exit(1)
  }
}

console.log(`Pack check passed: ${files.length} files, no forbidden content`)
