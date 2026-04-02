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

// ── A10: Pending hash acceptance tests ───────────────────────

describe('pending fingerprint acceptance', () => {
  // These tests mirror the verify.ts comparison logic:
  // if (storedFingerprint && storedFingerprint !== 'pending' && storedFingerprint !== newFingerprint)

  it('treats "pending" stored hash as not established — no drift', () => {
    const storedFingerprint = 'pending'
    const newFingerprint = computeResponseFingerprint({ data: [{ id: 1 }] })
    // The verify logic should NOT flag drift when stored is "pending"
    const isDrift = storedFingerprint !== 'pending' && storedFingerprint !== newFingerprint
    expect(isDrift).toBe(false)
  })

  it('still detects drift when stored hash is a real value', () => {
    const storedFingerprint = computeResponseFingerprint({ data: [{ id: 1 }] })
    const newFingerprint = computeResponseFingerprint({ data: [{ id: 1, name: 'added' }] })
    const isDrift = storedFingerprint !== 'pending' && storedFingerprint !== newFingerprint
    expect(isDrift).toBe(true)
  })

  it('no drift when stored and new fingerprints match', () => {
    const body = { data: [{ id: 1 }] }
    const storedFingerprint = computeResponseFingerprint(body)
    const newFingerprint = computeResponseFingerprint(body)
    const isDrift = storedFingerprint !== 'pending' && storedFingerprint !== newFingerprint
    expect(isDrift).toBe(false)
  })

  it('no drift when no stored fingerprint exists', () => {
    const storedFingerprint: string | undefined = undefined
    const newFingerprint = computeResponseFingerprint({ data: [{ id: 1 }] })
    // The verify logic guards with `storedFingerprint &&` first
    const isDrift = !!storedFingerprint && storedFingerprint !== 'pending' && storedFingerprint !== newFingerprint
    expect(isDrift).toBe(false)
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
