import { describe, it, expect } from 'vitest'

import { generateDriftReport, generateDriftReportMarkdown, hasNonPassResults, type SiteVerifyResult } from './verify.js'

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
    expect(sites[0]!.operations[0]!.drift_type).toBe('schema_drift')
    expect(sites[1]!.operations[0]!.drift_type).toBe('endpoint_removed')
    expect(sites[2]!.operations[0]!.drift_type).toBe('auth_drift')
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
    expect(hasNonPassResults([mockResults[0]!])).toBe(false)
  })
})
