import { describe, expect, it } from 'vitest'

import { computeResponseFingerprint } from './fingerprint.js'
import { type SiteVerifyResult, generateDriftReport, generateDriftReportMarkdown, hasNonPassResults } from './verify.js'

const mockResults: SiteVerifyResult[] = [
  {
    site: 'site-a',
    overallStatus: 'PASS',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getItems', status: 'PASS', newFingerprint: 'abc123' },
    ],
  },
  {
    site: 'site-b',
    overallStatus: 'DRIFT',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getList', status: 'DRIFT', driftType: 'schema_drift', detail: 'response shape changed', newFingerprint: 'new1', oldFingerprint: 'old1' },
    ],
  },
  {
    site: 'site-c',
    overallStatus: 'FAIL',
    shouldQuarantine: true,
    operations: [
      { operationId: 'getData', status: 'FAIL', driftType: 'endpoint_removed', detail: 'HTTP 404' },
    ],
  },
  {
    site: 'site-d',
    overallStatus: 'auth_expired',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getProfile', status: 'FAIL', driftType: 'auth_drift', detail: 'authentication expired (401/403)' },
    ],
  },
]

describe('generateDriftReport', () => {
  it('produces correct counts', () => {
    const report = generateDriftReport(mockResults) as Record<string, unknown>
    expect(report.total_sites).toBe(4)
    expect(report.passed).toBe(1)
    expect(report.drifted).toBe(1)
    expect(report.auth_expired).toBe(1)
    expect(report.failed).toBe(1)
  })

  it('only includes non-PASS sites', () => {
    const report = generateDriftReport(mockResults) as Record<string, unknown>
    const sites = report.sites as Array<{ site: string }>
    expect(sites).toHaveLength(3)
    expect(sites.map((s) => s.site)).toEqual(['site-b', 'site-c', 'site-d'])
  })

  it('includes drift details', () => {
    const report = generateDriftReport(mockResults) as Record<string, unknown>
    const sites = report.sites as Array<{ operations: Array<{ drift_type: string }> }>
    expect(sites[0]?.operations[0]?.drift_type).toBe('schema_drift')
    expect(sites[1]?.operations[0]?.drift_type).toBe('endpoint_removed')
    expect(sites[2]?.operations[0]?.drift_type).toBe('auth_drift')
  })
})

describe('generateDriftReportMarkdown', () => {
  it('produces markdown with headers', () => {
    const md = generateDriftReportMarkdown(mockResults)
    expect(md).toContain('# Drift Report')
    expect(md).toContain('site-b')
    expect(md).toContain('site-c')
    expect(md).toContain('site-d')
    expect(md).not.toContain('## ✓ site-a')
  })

  it('marks quarantined sites', () => {
    const md = generateDriftReportMarkdown(mockResults)
    expect(md).toContain('**Quarantined**')
  })

  it('includes auth_expired count', () => {
    const md = generateDriftReportMarkdown(mockResults)
    expect(md).toContain('auth_expired')
  })
})

describe('hasNonPassResults', () => {
  it('returns true when drift/fail/auth_expired present', () => {
    expect(hasNonPassResults(mockResults)).toBe(true)
  })

  it('returns false when all PASS', () => {
    expect(hasNonPassResults(mockResults.filter(r => r.overallStatus === 'PASS'))).toBe(false)
  })
})

// ── Fingerprint comparison tests ───────────────────────

describe('fingerprint comparison', () => {
  it('same structure produces same fingerprint', () => {
    const a = { users: [{ id: 1, name: 'Alice' }], count: 10 }
    const b = { users: [{ id: 2, name: 'Bob' }], count: 20 }
    expect(computeResponseFingerprint(a)).toBe(computeResponseFingerprint(b))
  })

  it('different structure produces different fingerprint', () => {
    const a = { users: [{ id: 1, name: 'Alice' }] }
    const b = { items: [{ sku: 'X', price: 9.99 }] }
    expect(computeResponseFingerprint(a)).not.toBe(computeResponseFingerprint(b))
  })

  it('detects added fields as drift', () => {
    const before = { id: 1, name: 'test' }
    const after = { id: 1, name: 'test', email: 'x@y.z' }
    expect(computeResponseFingerprint(before)).not.toBe(computeResponseFingerprint(after))
  })

  it('detects removed fields as drift', () => {
    const before = { id: 1, name: 'test', email: 'x@y.z' }
    const after = { id: 1, name: 'test' }
    expect(computeResponseFingerprint(before)).not.toBe(computeResponseFingerprint(after))
  })

  it('detects type changes (string→number) as drift', () => {
    const before = { value: 'hello' }
    const after = { value: 42 }
    expect(computeResponseFingerprint(before)).not.toBe(computeResponseFingerprint(after))
  })

  it('ignores value changes within same type', () => {
    const a = { status: 'active', count: 100 }
    const b = { status: 'inactive', count: 0 }
    expect(computeResponseFingerprint(a)).toBe(computeResponseFingerprint(b))
  })

  it('detects array element shape changes', () => {
    const before = { items: [{ id: 1 }] }
    const after = { items: [{ id: 1, extra: true }] }
    expect(computeResponseFingerprint(before)).not.toBe(computeResponseFingerprint(after))
  })

  it('null/undefined response has stable fingerprint', () => {
    expect(computeResponseFingerprint(null)).toBe(computeResponseFingerprint(null))
    expect(computeResponseFingerprint(undefined)).toBe(computeResponseFingerprint(undefined))
  })

  it('PASS when fingerprints match', () => {
    const body = { data: [{ id: 1 }] }
    const stored = computeResponseFingerprint(body)
    const current = computeResponseFingerprint(body)
    // Simulates the verify.ts comparison: stored === current → PASS
    expect(stored).toBe(current)
  })

  it('DRIFT when fingerprints differ', () => {
    const oldBody = { data: [{ id: 1 }] }
    const newBody = { data: [{ id: 1, name: 'added' }] }
    const stored = computeResponseFingerprint(oldBody)
    const current = computeResponseFingerprint(newBody)
    // Simulates the verify.ts comparison: stored !== current → DRIFT
    expect(stored).not.toBe(current)
  })
})
