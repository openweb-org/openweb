import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const KNOWLEDGE_DIR = path.join(os.homedir(), '.openweb', 'knowledge')
const PATTERNS_FILE = path.join(KNOWLEDGE_DIR, 'patterns.json')

export type PatternCategory = 'auth' | 'api' | 'pagination' | 'extraction' | 'discovery'

export interface PatternEntry {
  readonly id: string
  readonly category: PatternCategory
  readonly signal: string
  readonly action: string
  readonly source: string
  readonly addedAt: string
}

async function ensureDir(): Promise<void> {
  await mkdir(KNOWLEDGE_DIR, { recursive: true, mode: 0o700 })
}

export async function loadPatterns(): Promise<PatternEntry[]> {
  try {
    const raw = await readFile(PATTERNS_FILE, 'utf8')
    return JSON.parse(raw) as PatternEntry[]
  } catch {
    return []
  }
}

export async function savePatterns(patterns: PatternEntry[]): Promise<void> {
  await ensureDir()
  await writeFile(PATTERNS_FILE, `${JSON.stringify(patterns, null, 2)}\n`, { mode: 0o600 })
}

export async function addPattern(entry: Omit<PatternEntry, 'id' | 'addedAt'>): Promise<PatternEntry> {
  const patterns = await loadPatterns()
  const newEntry: PatternEntry = {
    ...entry,
    id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    addedAt: new Date().toISOString(),
  }
  patterns.push(newEntry)
  await savePatterns(patterns)
  return newEntry
}

export function getPatternsByCategory(patterns: PatternEntry[], category: PatternCategory): PatternEntry[] {
  return patterns.filter((p) => p.category === category)
}

export function getPatternsBySignal(patterns: PatternEntry[], signalSubstring: string): PatternEntry[] {
  const lower = signalSubstring.toLowerCase()
  return patterns.filter((p) => p.signal.toLowerCase().includes(lower))
}
