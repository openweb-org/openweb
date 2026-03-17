import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const KNOWLEDGE_DIR = path.join(os.homedir(), '.openweb', 'knowledge')
const FAILURES_FILE = path.join(KNOWLEDGE_DIR, 'failures.json')

/** Maximum number of failure entries to keep (append-only, prune oldest). */
const MAX_ENTRIES = 500

export interface FailureEntry {
  readonly site: string
  readonly operationId: string
  readonly failureClass: string
  readonly detail: string
  readonly fixApplied?: string
  readonly timestamp: string
}

async function ensureDir(): Promise<void> {
  await mkdir(KNOWLEDGE_DIR, { recursive: true, mode: 0o700 })
}

export async function loadFailures(): Promise<FailureEntry[]> {
  try {
    const raw = await readFile(FAILURES_FILE, 'utf8')
    return JSON.parse(raw) as FailureEntry[]
  } catch {
    return []
  }
}

export async function saveFailures(failures: FailureEntry[]): Promise<void> {
  await ensureDir()
  // Prune to MAX_ENTRIES (keep most recent)
  const pruned = failures.length > MAX_ENTRIES ? failures.slice(-MAX_ENTRIES) : failures
  await writeFile(FAILURES_FILE, `${JSON.stringify(pruned, null, 2)}\n`, { mode: 0o600 })
}

export async function recordFailure(entry: Omit<FailureEntry, 'timestamp'>): Promise<void> {
  return recordFailures([entry])
}

/** Batch-record multiple failures in a single write (avoids race conditions). */
export async function recordFailures(entries: Omit<FailureEntry, 'timestamp'>[]): Promise<void> {
  if (entries.length === 0) return
  const failures = await loadFailures()
  const now = new Date().toISOString()
  for (const entry of entries) {
    failures.push({ ...entry, timestamp: now })
  }
  await saveFailures(failures)
}

export function getFailuresForSite(failures: FailureEntry[], site: string): FailureEntry[] {
  return failures.filter((f) => f.site === site)
}

export function getFailuresByClass(failures: FailureEntry[], failureClass: string): FailureEntry[] {
  return failures.filter((f) => f.failureClass === failureClass)
}
