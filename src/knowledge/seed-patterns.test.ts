import { describe, it, expect } from 'vitest'
import { SEED_PATTERNS } from './seed-patterns.js'

describe('seed patterns', () => {
  it('has at least 20 entries', () => {
    expect(SEED_PATTERNS.length).toBeGreaterThanOrEqual(20)
  })

  it('all entries have required fields', () => {
    for (const entry of SEED_PATTERNS) {
      expect(entry.category).toBeTruthy()
      expect(entry.signal).toBeTruthy()
      expect(entry.action).toBeTruthy()
      expect(entry.source).toBeTruthy()
    }
  })

  it('covers all categories', () => {
    const categories = new Set(SEED_PATTERNS.map((p) => p.category))
    expect(categories).toContain('auth')
    expect(categories).toContain('api')
    expect(categories).toContain('extraction')
    expect(categories).toContain('pagination')
    expect(categories).toContain('discovery')
  })

  it('has unique signals', () => {
    const signals = SEED_PATTERNS.map((p) => p.signal)
    const uniqueSignals = new Set(signals)
    expect(uniqueSignals.size).toBe(signals.length)
  })
})
