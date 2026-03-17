import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const KNOWLEDGE_DIR = path.join(os.homedir(), '.openweb', 'knowledge')
const STATS_FILE = path.join(KNOWLEDGE_DIR, 'probe-stats.json')

/** Days after which stats start decaying in relevance. */
const STALENESS_DAYS = 30

export interface ProbeHeuristic {
  readonly signalType: string
  readonly successRate: number
  readonly sampleCount: number
  readonly lastUpdated: string
}

async function ensureDir(): Promise<void> {
  await mkdir(KNOWLEDGE_DIR, { recursive: true, mode: 0o700 })
}

export async function loadProbeStats(): Promise<ProbeHeuristic[]> {
  try {
    const raw = await readFile(STATS_FILE, 'utf8')
    return JSON.parse(raw) as ProbeHeuristic[]
  } catch {
    return []
  }
}

export async function saveProbeStats(stats: ProbeHeuristic[]): Promise<void> {
  await ensureDir()
  await writeFile(STATS_FILE, `${JSON.stringify(stats, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Record a probe outcome for a signal type.
 * Updates running average: newRate = (oldRate * oldCount + outcome) / (oldCount + 1)
 */
export async function recordProbeOutcome(
  signalType: string,
  success: boolean,
): Promise<void> {
  const stats = await loadProbeStats()
  const existing = stats.find((s) => s.signalType === signalType)
  const now = new Date().toISOString()

  if (existing) {
    const newCount = existing.sampleCount + 1
    const newRate = (existing.successRate * existing.sampleCount + (success ? 1 : 0)) / newCount
    const updated = stats.map((s) =>
      s.signalType === signalType
        ? { ...s, successRate: newRate, sampleCount: newCount, lastUpdated: now }
        : s,
    )
    await saveProbeStats(updated)
  } else {
    stats.push({
      signalType,
      successRate: success ? 1 : 0,
      sampleCount: 1,
      lastUpdated: now,
    })
    await saveProbeStats(stats)
  }
}

/**
 * Sort signal types by descending success rate (highest first).
 * Applies staleness decay: stats older than STALENESS_DAYS get reduced weight.
 */
export function sortBySuccessRate(stats: ProbeHeuristic[]): ProbeHeuristic[] {
  return [...stats].sort((a, b) => {
    const aScore = decayedScore(a)
    const bScore = decayedScore(b)
    return bScore - aScore
  })
}

function decayedScore(stat: ProbeHeuristic): number {
  const ageMs = Date.now() - new Date(stat.lastUpdated).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays <= STALENESS_DAYS) return stat.successRate
  // Linear decay: halves at 2x STALENESS_DAYS
  const decayFactor = Math.max(0, 1 - (ageDays - STALENESS_DAYS) / STALENESS_DAYS)
  return stat.successRate * decayFactor
}
