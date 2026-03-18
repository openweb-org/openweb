import { loadPatterns, savePatterns, addPattern, getPatternsByCategory, getPatternsBySignal } from '../knowledge/patterns.js'
import type { PatternEntry, PatternCategory } from '../knowledge/patterns.js'
import { loadProbeStats, sortBySuccessRate, decayedScore } from '../knowledge/heuristics.js'
import { loadFailures, getFailuresForSite, getFailuresByClass } from '../knowledge/failures.js'
import { SEED_PATTERNS } from '../knowledge/seed-patterns.js'

const VALID_CATEGORIES = new Set<PatternCategory>(['auth', 'api', 'pagination', 'extraction', 'discovery'])

// ── Table helpers ──

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length)
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const headerLine = headers.map((h, i) => padRight(h, widths[i]!)).join('   ')
  process.stdout.write(`${headerLine}\n`)
  for (const row of rows) {
    const line = row.map((cell, i) => padRight(cell, widths[i]!)).join('   ')
    process.stdout.write(`${line}\n`)
  }
}

// ── Seed initialization ──

async function seedIfEmpty(): Promise<PatternEntry[]> {
  const existing = await loadPatterns()
  if (existing.length > 0) return existing

  const now = new Date().toISOString()
  const seeded: PatternEntry[] = SEED_PATTERNS.map((sp, i) => ({
    id: `pat-seed-${i}`,
    category: sp.category,
    signal: sp.signal,
    action: sp.action,
    source: sp.source,
    addedAt: now,
  }))

  await savePatterns(seeded)
  return seeded
}

// ── Exported command handlers ──

export async function knowledgePatternsCommand(opts: { category?: string; signal?: string }): Promise<void> {
  let patterns = await seedIfEmpty()

  if (opts.category) {
    patterns = getPatternsByCategory(patterns, opts.category as PatternCategory)
  }
  if (opts.signal) {
    patterns = getPatternsBySignal(patterns, opts.signal)
  }

  if (patterns.length === 0) {
    process.stdout.write('No patterns found.\n')
    return
  }

  const rows = patterns.map((p) => [p.id, p.category, p.signal, p.action])
  printTable(['ID', 'Category', 'Signal', 'Action'], rows)
}

export async function knowledgeFailuresCommand(opts: { site?: string; class?: string }): Promise<void> {
  let failures = await loadFailures()

  if (opts.site) {
    failures = getFailuresForSite(failures, opts.site)
  }
  if (opts.class) {
    failures = getFailuresByClass(failures, opts.class)
  }

  if (failures.length === 0) {
    process.stdout.write('No failures found.\n')
    return
  }

  const rows = failures.map((f) => [f.site, f.operationId, f.failureClass, f.detail, f.timestamp])
  printTable(['Site', 'Operation', 'Class', 'Detail', 'Timestamp'], rows)
}

export async function knowledgeHeuristicsCommand(opts: { signal?: string }): Promise<void> {
  let stats = await loadProbeStats()

  if (opts.signal) {
    const lower = opts.signal.toLowerCase()
    stats = stats.filter((s) => s.signalType.toLowerCase().includes(lower))
  }

  const sorted = sortBySuccessRate(stats)

  if (sorted.length === 0) {
    process.stdout.write('No heuristics found.\n')
    return
  }

  const rows = sorted.map((s) => [
    s.signalType,
    s.successRate.toFixed(2),
    String(s.sampleCount),
    decayedScore(s).toFixed(2),
    s.lastUpdated.split('T')[0]!,
  ])
  printTable(['Signal Type', 'Success Rate', 'Samples', 'Score', 'Last Updated'], rows)
}

export async function knowledgeAddPatternCommand(opts: {
  category: string
  signal: string
  action: string
  source: string
}): Promise<void> {
  if (!VALID_CATEGORIES.has(opts.category as PatternCategory)) {
    process.stderr.write(`Invalid category: ${opts.category}. Must be one of: ${[...VALID_CATEGORIES].join(', ')}\n`)
    process.exit(1)
  }

  await seedIfEmpty()

  const entry = await addPattern({
    category: opts.category as PatternCategory,
    signal: opts.signal,
    action: opts.action,
    source: opts.source,
  })

  process.stdout.write(`Added pattern ${entry.id}:\n`)
  printTable(
    ['ID', 'Category', 'Signal', 'Action', 'Source'],
    [[entry.id, entry.category, entry.signal, entry.action, entry.source]],
  )
}
