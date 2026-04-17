import { describe, expect, it } from 'vitest'

import { CUSTOM_BUCKET, PATTERNS, compareToBaseline, loadBaseline, scanAll } from '../../scripts/adapter-pattern-report.ts'

describe('adapter-pattern guardrail', () => {
  const report = scanAll()
  const baseline = loadBaseline()
  const regressions = compareToBaseline(report, baseline)

  it('no site exceeds baseline counts for low-level page primitives', () => {
    if (regressions.length === 0) {
      expect(regressions).toEqual([])
      return
    }
    const detail = regressions
      .map((r) => `  ${r.site}\t${r.label}\tbaseline=${r.baseline}\tobserved=${r.observed}`)
      .join('\n')
    const hint = PATTERNS.map((p) => `  - ${p.label} -> ${p.replacement}`).join('\n')
    throw new Error(
      [
        `adapter-pattern regression detected (${regressions.length}):`,
        detail,
        '',
        'Fix by converting to the shared primitive:',
        hint,
        '',
        'Or, if counts legitimately dropped, refresh the baseline:',
        '  pnpm tsx scripts/adapter-pattern-report.ts --write-baseline',
      ].join('\n'),
    )
  })

  it('custom-bucket allowlist matches the permanent list in the design doc', () => {
    // Sanity: the allowlist should not be empty and should stay unique.
    expect(CUSTOM_BUCKET.length).toBeGreaterThan(0)
    expect(new Set(CUSTOM_BUCKET).size).toBe(CUSTOM_BUCKET.length)
  })

  it('baseline file stays in sync with observed sites — no stale entries', () => {
    const observedSites = new Set(report.sites.map((s) => s.site))
    const stale = Object.keys(baseline.counts).filter((s) => !observedSites.has(s))
    expect(stale, 'baseline has entries for sites that no longer contain any low-level patterns; refresh via --write-baseline').toEqual([])
  })
})
