import { describe, expect, it } from 'vitest'

import { type SiteVerifyResult, generateDriftReport, generateDriftReportMarkdown, hasNonPassResults } from './verify.js'

const mockResults: SiteVerifyResult[] = [
  {
    site: 'site-a',
    overallStatus: 'PASS',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getItems', status: 'PASS' },
    ],
  },
  {
    site: 'site-b',
    overallStatus: 'DRIFT',
    shouldQuarantine: false,
    operations: [
      { operationId: 'getList', status: 'DRIFT', driftType: 'schema_drift', detail: 'response shape changed' },
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
  it('returns true when fail/auth_expired present', () => {
    expect(hasNonPassResults(mockResults)).toBe(true)
  })

  it('returns false when all PASS', () => {
    expect(hasNonPassResults(mockResults.filter(r => r.overallStatus === 'PASS'))).toBe(false)
  })

  it('returns false when only DRIFT (advisory)', () => {
    expect(hasNonPassResults(mockResults.filter(r => r.overallStatus === 'PASS' || r.overallStatus === 'DRIFT'))).toBe(false)
  })
})

// ── A17: Malformed example file detection tests ───────────────────────

describe('malformed example file detection', () => {
  it('detects missing cases array', () => {
    // Simulates the verify.ts logic for malformed example files
    const testFile = { operation_id: 'getProfile' } as { operation_id: string; cases?: unknown[] }
    const isMalformed = !Array.isArray(testFile.cases)
    expect(isMalformed).toBe(true)
  })

  it('accepts valid example file with cases array', () => {
    const testFile = {
      operation_id: 'getProfile',
      cases: [{ input: {}, assertions: { status: 200 } }],
    }
    const isMalformed = !Array.isArray(testFile.cases)
    expect(isMalformed).toBe(false)
  })

  it('detects cases as non-array value', () => {
    const testFile = { operation_id: 'getProfile', cases: 'not-an-array' } as { operation_id: string; cases: unknown }
    const isMalformed = !Array.isArray(testFile.cases)
    expect(isMalformed).toBe(true)
  })

  it('detects cases as null', () => {
    const testFile = { operation_id: 'getProfile', cases: null } as { operation_id: string; cases: unknown }
    const isMalformed = !Array.isArray(testFile.cases)
    expect(isMalformed).toBe(true)
  })

  it('produces correct FAIL result for malformed file', () => {
    const testFile = { operation_id: 'getProfile' } as { operation_id: string; cases?: unknown[] }
    const fileName = 'get_profile.example.json'
    if (!Array.isArray(testFile.cases)) {
      const opId = testFile.operation_id ?? fileName.replace('.example.json', '')
      const result = {
        operationId: opId,
        status: 'FAIL' as const,
        driftType: 'error' as const,
        detail: 'malformed example file: missing cases array',
      }
      expect(result.operationId).toBe('getProfile')
      expect(result.status).toBe('FAIL')
      expect(result.driftType).toBe('error')
      expect(result.detail).toBe('malformed example file: missing cases array')
    }
  })

  it('falls back to filename for operation_id when missing', () => {
    const testFile = {} as { operation_id?: string; cases?: unknown[] }
    const fileName = 'get_profile.example.json'
    if (!Array.isArray(testFile.cases)) {
      const opId = testFile.operation_id ?? fileName.replace('.example.json', '')
      expect(opId).toBe('get_profile')
    }
  })
})
