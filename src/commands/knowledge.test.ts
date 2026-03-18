import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

const { readFile, writeFile, mkdir } = await import('node:fs/promises')

const {
  knowledgePatternsCommand,
  knowledgeFailuresCommand,
  knowledgeHeuristicsCommand,
  knowledgeAddPatternCommand,
} = await import('./knowledge.js')

const { SEED_PATTERNS } = await import('../knowledge/seed-patterns.js')

import type { PatternEntry } from '../knowledge/patterns.js'
import type { FailureEntry } from '../knowledge/failures.js'
import type { ProbeHeuristic } from '../knowledge/heuristics.js'

const samplePatterns: PatternEntry[] = [
  { id: 'pat-1', category: 'auth', signal: 'cookie starts with __cf', action: 'exclude from detection', source: 'M15', addedAt: '2025-01-01T00:00:00Z' },
  { id: 'pat-2', category: 'api', signal: 'status 429', action: 'mark retriable', source: 'M10', addedAt: '2025-01-01T00:00:00Z' },
  { id: 'pat-3', category: 'auth', signal: 'SAPISID cookie present', action: 'use sapisidhash', source: 'M9', addedAt: '2025-01-01T00:00:00Z' },
]

const sampleFailures: FailureEntry[] = [
  { site: 'uber', operationId: 'op-1', failureClass: 'auth_expired', detail: 'Token expired', timestamp: '2025-01-01T00:00:00Z' },
  { site: 'github', operationId: 'op-2', failureClass: 'rate_limit', detail: 'Rate limited', timestamp: '2025-01-02T00:00:00Z' },
  { site: 'uber', operationId: 'op-3', failureClass: 'selector_miss', detail: 'Selector not found', timestamp: '2025-01-03T00:00:00Z' },
]

const sampleHeuristics: ProbeHeuristic[] = [
  { signalType: 'cookie_session', successRate: 0.85, sampleCount: 20, lastUpdated: new Date().toISOString() },
  { signalType: 'localstorage_jwt', successRate: 0.72, sampleCount: 10, lastUpdated: new Date().toISOString() },
]

describe('knowledge commands', () => {
  let output: string

  beforeEach(() => {
    vi.clearAllMocks()
    output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)
  })

  describe('knowledgePatternsCommand', () => {
    it('outputs table when patterns exist', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(samplePatterns))

      await knowledgePatternsCommand({})

      expect(output).toContain('ID')
      expect(output).toContain('Category')
      expect(output).toContain('Signal')
      expect(output).toContain('Action')
      expect(output).toContain('pat-1')
      expect(output).toContain('auth')
      expect(output).toContain('cookie starts with __cf')
    })

    it('filters by --category', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(samplePatterns))

      await knowledgePatternsCommand({ category: 'api' })

      expect(output).toContain('pat-2')
      expect(output).toContain('status 429')
      expect(output).not.toContain('pat-1')
      expect(output).not.toContain('pat-3')
    })

    it('seeds from SEED_PATTERNS when empty', async () => {
      // First call to loadPatterns returns empty (triggers seed), second call is the load after save
      let callCount = 0
      vi.mocked(readFile).mockImplementation(async () => {
        callCount++
        if (callCount === 1) throw new Error('ENOENT')
        // After seeding, return the seeded patterns
        const seeded = SEED_PATTERNS.map((sp, i) => ({
          id: `pat-seed-${i}`,
          category: sp.category,
          signal: sp.signal,
          action: sp.action,
          source: sp.source,
          addedAt: '2025-01-01T00:00:00Z',
        }))
        return JSON.stringify(seeded)
      })

      await knowledgePatternsCommand({})

      // savePatterns should have been called with entries matching SEED_PATTERNS length
      expect(writeFile).toHaveBeenCalledTimes(1)
      const writtenData = vi.mocked(writeFile).mock.calls[0]![1] as string
      const writtenPatterns = JSON.parse(writtenData.trim())
      expect(writtenPatterns).toHaveLength(SEED_PATTERNS.length)

      // Output should contain seeded patterns
      expect(output).toContain('pat-seed-0')
    })
  })

  describe('knowledgeFailuresCommand', () => {
    it('outputs table when failures exist', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleFailures))

      await knowledgeFailuresCommand({})

      expect(output).toContain('Site')
      expect(output).toContain('Operation')
      expect(output).toContain('Class')
      expect(output).toContain('uber')
      expect(output).toContain('auth_expired')
      expect(output).toContain('github')
    })

    it('filters by --site', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleFailures))

      await knowledgeFailuresCommand({ site: 'uber' })

      expect(output).toContain('uber')
      expect(output).not.toContain('github')
    })
  })

  describe('knowledgeHeuristicsCommand', () => {
    it('outputs table with decayed scores', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleHeuristics))

      await knowledgeHeuristicsCommand({})

      expect(output).toContain('Signal Type')
      expect(output).toContain('Success Rate')
      expect(output).toContain('Samples')
      expect(output).toContain('Score')
      expect(output).toContain('Last Updated')
      expect(output).toContain('cookie_session')
      expect(output).toContain('0.85')
      expect(output).toContain('20')
    })
  })

  describe('knowledgeAddPatternCommand', () => {
    it('creates new pattern and outputs it', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify([]))

      await knowledgeAddPatternCommand({
        category: 'auth',
        signal: 'test signal',
        action: 'test action',
        source: 'test source',
      })

      expect(output).toContain('Added pattern')
      expect(output).toContain('auth')
      expect(output).toContain('test signal')
      expect(output).toContain('test action')
      expect(output).toContain('test source')
      expect(writeFile).toHaveBeenCalled()
    })
  })
})
