import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadProbeStats, saveProbeStats, recordProbeOutcome, sortBySuccessRate, type ProbeHeuristic } from './heuristics.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

const { readFile, writeFile, mkdir } = await import('node:fs/promises')

describe('probe heuristics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadProbeStats returns empty array when file missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    const result = await loadProbeStats()
    expect(result).toEqual([])
  })

  it('recordProbeOutcome creates new entry for unknown signal', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await recordProbeOutcome('node_no_auth', true)

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string)
    expect(written).toHaveLength(1)
    expect(written[0].signalType).toBe('node_no_auth')
    expect(written[0].successRate).toBe(1)
    expect(written[0].sampleCount).toBe(1)
  })

  it('recordProbeOutcome updates running average', async () => {
    const existing: ProbeHeuristic[] = [
      { signalType: 'node_no_auth', successRate: 1, sampleCount: 1, lastUpdated: new Date().toISOString() },
    ]
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await recordProbeOutcome('node_no_auth', false)

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string)
    expect(written[0].successRate).toBe(0.5) // (1*1 + 0) / 2
    expect(written[0].sampleCount).toBe(2)
  })

  it('sortBySuccessRate sorts descending', () => {
    const now = new Date().toISOString()
    const stats: ProbeHeuristic[] = [
      { signalType: 'low', successRate: 0.3, sampleCount: 10, lastUpdated: now },
      { signalType: 'high', successRate: 0.9, sampleCount: 10, lastUpdated: now },
      { signalType: 'mid', successRate: 0.6, sampleCount: 10, lastUpdated: now },
    ]
    const sorted = sortBySuccessRate(stats)
    expect(sorted.map((s) => s.signalType)).toEqual(['high', 'mid', 'low'])
  })

  it('sortBySuccessRate applies decay to stale entries', () => {
    const fresh = new Date().toISOString()
    const stale = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() // 45 days old
    const stats: ProbeHeuristic[] = [
      { signalType: 'stale_high', successRate: 0.9, sampleCount: 10, lastUpdated: stale },
      { signalType: 'fresh_low', successRate: 0.5, sampleCount: 10, lastUpdated: fresh },
    ]
    const sorted = sortBySuccessRate(stats)
    // Stale entry (45 days old, 30 day threshold) should decay: 0.9 * (1 - 15/30) = 0.45
    // Fresh entry stays at 0.5
    expect(sorted[0]!.signalType).toBe('fresh_low')
  })
})
