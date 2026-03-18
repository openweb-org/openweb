import { describe, expect, it, vi } from 'vitest'

import { compileCommand, generateReviewHints, formatSummary, compileSite } from './compile.js'
import type { CompileSummary } from './compile.js'

vi.mock('../compiler/recorder.js', () => ({
  runScriptedRecording: vi.fn(),
  loadRecordedSamples: vi.fn(),
  loadCaptureData: vi.fn(),
  cleanupRecordingDir: vi.fn(),
}))

vi.mock('../compiler/generator.js', () => ({
  generatePackage: vi.fn(),
}))

const { runScriptedRecording, loadRecordedSamples, loadCaptureData, cleanupRecordingDir } = await import('../compiler/recorder.js')
const { generatePackage } = await import('../compiler/generator.js')

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

describe('compileSite integration — summary population', () => {
  it('populates summary with correct counts from pipeline', async () => {
    const getSample = (path: string, method = 'GET') => ({
      method,
      host: 'api.example.com',
      path,
      url: `https://api.example.com${path}?q=test`,
      query: { q: ['test'] },
      status: 200,
      contentType: 'application/json',
      responseJson: { ok: true },
    })

    // 8 total samples: 5 GET on api.example.com, 1 POST with body, 2 noise on tracking.example.com
    const allSamples = [
      getSample('/api/users'),
      getSample('/api/users'),
      getSample('/api/posts'),
      getSample('/api/posts'),
      getSample('/api/posts'),
      { ...getSample('/api/create', 'POST'), requestBody: '{"name":"test"}' },
      { ...getSample('/track/event'), host: 'analytics.trackingco.net', url: 'https://analytics.trackingco.net/track/event' },
      { ...getSample('/track/pixel'), host: 'analytics.trackingco.net', url: 'https://analytics.trackingco.net/track/pixel' },
    ]

    vi.mocked(runScriptedRecording).mockResolvedValue('/tmp/fake-recording')
    vi.mocked(loadRecordedSamples).mockResolvedValue(allSamples)
    vi.mocked(loadCaptureData).mockResolvedValue({
      harEntries: [],
      stateSnapshots: [],
      domHtml: undefined,
    })
    vi.mocked(cleanupRecordingDir).mockResolvedValue(undefined)
    vi.mocked(generatePackage).mockResolvedValue('/tmp/sites/example-fixture')

    const result = await compileSite(
      { url: 'https://api.example.com' },
      { verifyReplay: false, emitSummary: false },
    )

    expect(result.summary).toBeDefined()
    const summary = result.summary!

    // totalSamples = all 8 raw samples
    expect(summary.totalSamples).toBe(8)
    // filterSamples removes tracking.example.com (different host from target URL domain)
    expect(summary.filteredSamples).toBeLessThan(summary.totalSamples)
    expect(summary.rejectedSamples).toBe(summary.totalSamples - summary.filteredSamples)
    // POST with body → skipped mutation
    expect(summary.skippedMutations).toBe(1)
    // GET clusters produce operations (2 paths: /api/users, /api/posts)
    expect(summary.operations).toBeGreaterThanOrEqual(2)
    // verifyReplay: false → verifiedCount = 0
    expect(summary.verifiedCount).toBe(0)
    // No classify data → no auth primitive
    expect(summary.primitives.auth).toBeUndefined()
    // reviewHints should include "no auth" and "no operations verified"
    expect(summary.reviewHints.some((h) => h.includes('No auth primitive'))).toBe(true)
    expect(summary.reviewHints.some((h) => h.includes('No operations verified'))).toBe(true)
    expect(summary.reviewHints.some((h) => h.includes('mutation'))).toBe(true)
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
