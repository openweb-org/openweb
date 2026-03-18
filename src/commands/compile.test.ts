import { describe, expect, it } from 'vitest'

import { compileCommand, generateReviewHints, formatSummary } from './compile.js'
import type { CompileSummary } from './compile.js'

describe('compileCommand', () => {
  it('rejects interactive mode in MVP scaffold', async () => {
    await expect(
      compileCommand({
        url: 'https://open-meteo.com',
        interactive: true,
      }),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
      },
    })
  })
})

describe('generateReviewHints', () => {
  const baseSummary: Omit<CompileSummary, 'reviewHints'> = {
    site: 'test',
    totalSamples: 50,
    filteredSamples: 30,
    rejectedSamples: 20,
    operations: 10,
    skippedMutations: 0,
    verifiedCount: 5,
    primitives: { auth: 'cookie_session' },
  }

  it('returns empty hints for healthy compile', () => {
    expect(generateReviewHints(baseSummary)).toEqual([])
  })

  it('warns when few samples captured', () => {
    const hints = generateReviewHints({ ...baseSummary, filteredSamples: 3 })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('Very few API samples')
  })

  it('warns when mutations skipped', () => {
    const hints = generateReviewHints({ ...baseSummary, skippedMutations: 2 })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('2 mutation operation(s) skipped')
  })

  it('warns when no auth detected', () => {
    const hints = generateReviewHints({ ...baseSummary, primitives: {} })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('No auth primitive detected')
  })

  it('warns when no operations verified', () => {
    const hints = generateReviewHints({ ...baseSummary, verifiedCount: 0 })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('No operations verified')
  })

  it('warns when many operations generated', () => {
    const hints = generateReviewHints({ ...baseSummary, operations: 60, verifiedCount: 30 })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('Many operations generated')
  })

  it('combines multiple hints', () => {
    const hints = generateReviewHints({
      ...baseSummary,
      filteredSamples: 2,
      skippedMutations: 3,
      primitives: {},
      verifiedCount: 0,
    })
    expect(hints).toHaveLength(4)
  })
})

describe('formatSummary', () => {
  it('formats structured summary block', () => {
    const summary: CompileSummary = {
      site: 'uber',
      totalSamples: 127,
      filteredSamples: 34,
      rejectedSamples: 93,
      operations: 12,
      skippedMutations: 2,
      verifiedCount: 3,
      primitives: { auth: 'exchange_chain' },
      reviewHints: ['2 mutation operation(s) skipped (request body inference not supported). Agent should identify these manually if needed.'],
    }

    const output = formatSummary(summary, 'sites/uber-fixture/')
    expect(output).toContain('Compile Summary: uber')
    expect(output).toContain('127 captured')
    expect(output).toContain('34 after filter')
    expect(output).toContain('93 rejected')
    expect(output).toContain('12 (3 verified, 2 mutations skipped)')
    expect(output).toContain('auth=exchange_chain')
    expect(output).toContain('csrf=none')
    expect(output).toContain('⚠')
    expect(output).toContain('sites/uber-fixture/')
  })

  it('omits hints section when no hints', () => {
    const summary: CompileSummary = {
      site: 'test',
      totalSamples: 50,
      filteredSamples: 30,
      rejectedSamples: 20,
      operations: 10,
      skippedMutations: 0,
      verifiedCount: 5,
      primitives: { auth: 'cookie_session' },
      reviewHints: [],
    }

    const output = formatSummary(summary, 'sites/test-fixture/')
    expect(output).not.toContain('Hints')
    expect(output).not.toContain('⚠')
  })

  it('includes extractions count when present', () => {
    const summary: CompileSummary = {
      site: 'walmart',
      totalSamples: 20,
      filteredSamples: 15,
      rejectedSamples: 5,
      operations: 5,
      skippedMutations: 0,
      verifiedCount: 3,
      primitives: { auth: 'cookie_session', extractions: 2 },
      reviewHints: [],
    }

    const output = formatSummary(summary, 'sites/walmart-fixture/')
    expect(output).toContain('extractions=2')
  })
})
