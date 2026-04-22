#!/usr/bin/env tsx
/**
 * Adapter pattern guardrail: reports low-level page primitives in per-site
 * adapter code. The normalize-adapter migration moved navigation, readiness,
 * extraction, and response capture into shared runtime primitives (PagePlan,
 * script_json / ssr_next_data / html_selector, response_capture, CustomRunner).
 * Sites outside the permanent custom bucket should not re-introduce these
 * patterns in their adapter code.
 *
 * Enforcement model: a committed baseline (scripts/adapter-pattern-baseline.json)
 * freezes current per-site counts. CI fails when a site exceeds its baseline
 * or when a new violation appears in a non-baseline site. Shrinking the baseline
 * is the unit of forward progress.
 *
 * Usage:
 *   pnpm tsx scripts/adapter-pattern-report.ts               # human report
 *   pnpm tsx scripts/adapter-pattern-report.ts --json        # machine report
 *   pnpm tsx scripts/adapter-pattern-report.ts --check       # exit 1 on regression
 *   pnpm tsx scripts/adapter-pattern-report.ts --write-baseline  # refresh baseline
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface PatternDef {
  readonly id: string
  readonly label: string
  readonly pattern: RegExp
  readonly replacement: string
}

export const PATTERNS: readonly PatternDef[] = [
  { id: 'page_goto', label: 'page.goto(', pattern: /\bpage\.goto\s*\(/, replacement: 'x-openweb.page_plan (entry_url / ready / warm)' },
  { id: 'page_evaluate_fetch', label: 'page.evaluate(fetch', pattern: /\bpage\.evaluate\s*\([^)]*\bfetch\s*\(/, replacement: 'transport: page with declared auth/csrf, or helpers.pageFetch' },
  { id: 'page_on_response', label: "page.on('response'", pattern: /\bpage\.on\s*\(\s*['"]response['"]/, replacement: 'extraction.type: response_capture' },
  { id: 'query_selector', label: 'querySelector', pattern: /\bquerySelector(All)?\s*\(/, replacement: 'extraction.type: html_selector | page_global_data | script_json' },
  { id: 'next_data', label: '__NEXT_DATA__', pattern: /__NEXT_DATA__/, replacement: 'extraction.type: ssr_next_data (or script_json with selector)' },
]

/**
 * Permanent custom bucket — sites allowed to carry low-level page primitives
 * in their adapter code. Aligned with the design doc:
 *   projects/active/normalize-adapter/final/design.md § Permanent Custom Bucket.
 *
 * New violations in these sites are allowed (still capped by baseline).
 */
export const CUSTOM_BUCKET: readonly string[] = [
  // hard 13 — irreducible signing / module-system / binary protocols (OQ 11)
  'bilibili',
  'bluesky',
  'google-maps',
  'instagram',
  'linkedin',
  'notion',
  'opentable',
  'spotify',
  'telegram',
  'tiktok',
  'whatsapp',
  'x',
  'youtube',
  // partial — some ops normalize, others stay custom
  'booking',
  'costco',
  'goodrx',
]
const CUSTOM_SET = new Set(CUSTOM_BUCKET)

const BASELINE_PATH = path.resolve(process.cwd(), 'scripts/adapter-pattern-baseline.json')

export interface Violation {
  readonly site: string
  readonly file: string
  readonly line: number
  readonly patternId: string
  readonly label: string
  readonly snippet: string
}

export interface SiteReport {
  readonly site: string
  readonly allowlisted: boolean
  readonly counts: Record<string, number>
  readonly total: number
  readonly violations: readonly Violation[]
}

export interface ScanReport {
  readonly sites: readonly SiteReport[]
  readonly totalCounts: Record<string, number>
}

export interface BaselineFile {
  readonly generated: string
  readonly note: string
  readonly counts: Record<string, Record<string, number>>
}

export function scanSite(sitesDir: string, site: string): SiteReport {
  const adaptersDir = path.join(sitesDir, site, 'adapters')
  const counts: Record<string, number> = {}
  const violations: Violation[] = []
  for (const p of PATTERNS) counts[p.id] = 0

  if (!existsSync(adaptersDir) || !statSync(adaptersDir).isDirectory()) {
    return { site, allowlisted: CUSTOM_SET.has(site), counts, total: 0, violations }
  }

  for (const f of readdirSync(adaptersDir)) {
    if (!f.endsWith('.ts')) continue
    const file = path.join(adaptersDir, f)
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    for (const p of PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (p.pattern.test(line)) {
          counts[p.id] = (counts[p.id] || 0) + 1
          violations.push({
            site,
            file: path.relative(process.cwd(), file),
            line: i + 1,
            patternId: p.id,
            label: p.label,
            snippet: line.trim().slice(0, 140),
          })
        }
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { site, allowlisted: CUSTOM_SET.has(site), counts, total, violations }
}

export function scanAll(sitesDir = path.resolve(process.cwd(), 'src/sites')): ScanReport {
  const sites = readdirSync(sitesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const reports: SiteReport[] = []
  const totalCounts: Record<string, number> = {}
  for (const p of PATTERNS) totalCounts[p.id] = 0

  for (const site of sites) {
    const r = scanSite(sitesDir, site)
    if (r.total > 0) {
      reports.push(r)
      for (const p of PATTERNS) totalCounts[p.id] += r.counts[p.id]
    }
  }
  return { sites: reports, totalCounts }
}

export interface Regression {
  readonly site: string
  readonly patternId: string
  readonly label: string
  readonly baseline: number
  readonly observed: number
}

export function compareToBaseline(report: ScanReport, baseline: BaselineFile): Regression[] {
  const regressions: Regression[] = []
  for (const r of report.sites) {
    const base = baseline.counts[r.site] || {}
    for (const p of PATTERNS) {
      const observed = r.counts[p.id] || 0
      const b = base[p.id] || 0
      if (observed > b) regressions.push({ site: r.site, patternId: p.id, label: p.label, baseline: b, observed })
    }
  }
  return regressions
}

export function loadBaseline(): BaselineFile {
  if (!existsSync(BASELINE_PATH)) {
    return { generated: '', note: '', counts: {} }
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile
}

export function writeBaseline(report: ScanReport): void {
  const counts: Record<string, Record<string, number>> = {}
  for (const r of report.sites) {
    const row: Record<string, number> = {}
    for (const p of PATTERNS) {
      const v = r.counts[p.id] || 0
      if (v > 0) row[p.id] = v
    }
    if (Object.keys(row).length > 0) counts[r.site] = row
  }
  const sortedCounts: Record<string, Record<string, number>> = {}
  for (const k of Object.keys(counts).sort()) sortedCounts[k] = counts[k]
  const file: BaselineFile = {
    generated: new Date().toISOString().slice(0, 10),
    note: 'Baseline pattern counts per site. See scripts/adapter-pattern-report.ts — ratcheting down is the unit of forward progress for normalize-adapter. Refresh via --write-baseline only after counts legitimately drop.',
    counts: sortedCounts,
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(file, null, 2)}\n`)
}

function renderText(report: ScanReport, regressions: readonly Regression[]): string {
  const lines: string[] = []
  lines.push('Adapter pattern report')
  lines.push('======================')
  lines.push('')
  lines.push('Totals:')
  for (const p of PATTERNS) lines.push(`  ${p.label.padEnd(22)} ${report.totalCounts[p.id] || 0}`)
  lines.push('')
  lines.push('Per-site:')
  for (const r of report.sites) {
    const tag = r.allowlisted ? '[custom]    ' : '[normalized]'
    const breakdown = PATTERNS.map((p) => `${p.label}=${r.counts[p.id] || 0}`).join(' ')
    lines.push(`  ${tag} ${r.site.padEnd(16)} total=${String(r.total).padStart(3)}  ${breakdown}`)
  }
  if (regressions.length > 0) {
    lines.push('')
    lines.push('REGRESSIONS above baseline:')
    for (const r of regressions) {
      lines.push(`  ${r.site}\t${r.label}\tbaseline=${r.baseline}\tobserved=${r.observed}`)
    }
    lines.push('')
    lines.push('Fix: use the corresponding shared primitive —')
    for (const p of PATTERNS) lines.push(`  - ${p.label.padEnd(22)} -> ${p.replacement}`)
    lines.push('')
    lines.push('Or, if the count dropped legitimately, refresh the baseline:')
    lines.push('  pnpm tsx scripts/adapter-pattern-report.ts --write-baseline')
  }
  return lines.join('\n')
}

function main(): number {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const check = args.includes('--check')
  const write = args.includes('--write-baseline')

  const report = scanAll()

  if (write) {
    writeBaseline(report)
    process.stdout.write(`wrote baseline ${path.relative(process.cwd(), BASELINE_PATH)}\n`)
    return 0
  }

  const baseline = loadBaseline()
  const regressions = compareToBaseline(report, baseline)

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ...report, regressions }, null, 2)}\n`)
  } else {
    process.stdout.write(`${renderText(report, regressions)}\n`)
  }

  if (check && regressions.length > 0) {
    process.stderr.write(`\nadapter-pattern-report: ${regressions.length} regression(s) vs baseline.\n`)
    return 1
  }
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const selfPath = path.resolve(new URL(import.meta.url).pathname)
if (invokedPath === selfPath) {
  process.exit(main())
}
