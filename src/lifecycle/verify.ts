import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { executeOperation, type ExecuteDependencies } from '../runtime/executor.js'
import { recordFailures } from '../knowledge/failures.js'
import { listSites, resolveSiteRoot } from '../lib/openapi.js'
import { OpenWebError } from '../lib/errors.js'
import { computeResponseFingerprint } from './fingerprint.js'
import { loadManifest, saveManifest } from '../lib/manifest.js'
import type { Manifest } from '../types/manifest.js'

export type DriftType = 'schema_drift' | 'auth_drift' | 'endpoint_removed' | 'error'

export type OperationStatus = 'PASS' | 'DRIFT' | 'FAIL'

/** Site-level overall status — includes 'auth_expired' for auth-only failures. */
export type SiteOverallStatus = OperationStatus | 'auth_expired'

export interface OperationVerifyResult {
  readonly operationId: string
  readonly status: OperationStatus
  readonly driftType?: DriftType
  readonly detail?: string
  readonly newFingerprint?: string
  readonly oldFingerprint?: string
}

export interface SiteVerifyResult {
  readonly site: string
  readonly operations: OperationVerifyResult[]
  readonly overallStatus: SiteOverallStatus
  readonly shouldQuarantine: boolean
}

interface TestCase {
  readonly input: Record<string, unknown>
  readonly assertions: {
    readonly status: number
    readonly response_schema_valid?: boolean
  }
}

interface TestFile {
  readonly operation_id: string
  readonly cases: TestCase[]
}

function isAuthDrift(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'needs_login'
}

function isPageMissing(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'needs_page'
}

function isRetriable(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'retriable'
}

/**
 * Verify a single site: run all test cases, compare fingerprints.
 */
export async function verifySite(
  site: string,
  deps?: ExecuteDependencies,
): Promise<SiteVerifyResult> {
  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)
  const storedFingerprints = manifest?.fingerprint?.response_shape_hash
    ? parseStoredFingerprints(manifest.fingerprint.response_shape_hash)
    : new Map<string, string>()

  const testsDir = path.join(siteRoot, 'tests')
  let testFiles: string[]
  try {
    testFiles = (await readdir(testsDir)).filter((f) => f.endsWith('.test.json'))
  } catch {
    return { site, operations: [], overallStatus: 'FAIL', shouldQuarantine: false }
  }

  const operations: OperationVerifyResult[] = []

  for (const fileName of testFiles) {
    const raw = await readFile(path.join(testsDir, fileName), 'utf8')
    const testFile = JSON.parse(raw) as TestFile

    for (const testCase of testFile.cases) {
      const result = await verifyOperation(
        site,
        testFile.operation_id,
        testCase,
        storedFingerprints.get(testFile.operation_id),
        deps,
      )
      operations.push(result)
    }
  }

  // Batch-record failures to knowledge base (single write, no race)
  const failedOps = operations.filter((op) => op.status !== 'PASS')
  if (failedOps.length > 0) {
    recordFailures(failedOps.map((op) => ({
      site,
      operationId: op.operationId,
      failureClass: op.driftType ?? 'unknown',
      detail: op.detail ?? '',
    }))).catch(() => {}) // non-fatal: don't block verify on knowledge write
  }

  // Determine overall status
  const hasDrift = operations.some((o) => o.status === 'DRIFT')
  const hasRealFail = operations.some((o) => o.status === 'FAIL' && o.driftType !== 'auth_drift')
  const hasAuthDrift = operations.some((o) => o.driftType === 'auth_drift')
  const hasPass = operations.some((o) => o.status === 'PASS')

  let overallStatus: SiteOverallStatus
  if (hasRealFail) {
    overallStatus = 'FAIL'
  } else if (hasDrift) {
    overallStatus = 'DRIFT'
  } else if (hasAuthDrift) {
    // ANY auth_drift taints the result — even if some ops passed
    overallStatus = 'auth_expired'
  } else if (hasPass) {
    overallStatus = 'PASS'
  } else {
    overallStatus = 'FAIL'
  }

  // Quarantine on real failures — NOT on auth_expired, NOT on PASS
  const shouldQuarantine = hasRealFail

  // Update manifest with verification results
  if (manifest) {
    const newFingerprints = new Map(storedFingerprints)
    for (const op of operations) {
      if (op.newFingerprint) {
        newFingerprints.set(op.operationId, op.newFingerprint)
      }
    }

    // Only clear quarantine on actual PASS — not auth_expired
    const updatedQuarantine = shouldQuarantine
      ? true
      : overallStatus === 'PASS' ? false : manifest.quarantined

    const updated: Manifest = {
      ...manifest,
      last_verified: new Date().toISOString(),
      quarantined: updatedQuarantine,
      fingerprint: {
        ...manifest.fingerprint,
        response_shape_hash: serializeFingerprints(newFingerprints),
        last_validated: new Date().toISOString(),
      },
    }
    await saveManifest(siteRoot, updated)
  }

  return { site, operations, overallStatus, shouldQuarantine }
}

async function verifyOperation(
  site: string,
  operationId: string,
  testCase: TestCase,
  storedFingerprint: string | undefined,
  deps?: ExecuteDependencies,
): Promise<OperationVerifyResult> {
  try {
    const result = await executeOperation(site, operationId, testCase.input, deps)
    const statusPass = result.status === testCase.assertions.status
    const schemaPass = testCase.assertions.response_schema_valid === undefined
      || result.responseSchemaValid === testCase.assertions.response_schema_valid

    if (!statusPass || !schemaPass) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'schema_drift',
        detail: `expected status=${testCase.assertions.status} schema=${testCase.assertions.response_schema_valid}; got status=${result.status} schema=${result.responseSchemaValid}`,
      }
    }

    // Compute and compare fingerprint
    const newFingerprint = computeResponseFingerprint(result.body)

    if (storedFingerprint && storedFingerprint !== newFingerprint) {
      return {
        operationId,
        status: 'DRIFT',
        driftType: 'schema_drift',
        detail: 'response shape changed',
        newFingerprint,
        oldFingerprint: storedFingerprint,
      }
    }

    return { operationId, status: 'PASS', newFingerprint }
  } catch (error) {
    if (isAuthDrift(error)) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'auth_drift',
        detail: 'authentication expired (401/403)',
      }
    }
    if (isPageMissing(error)) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'error',
        detail: 'no browser tab open for this site',
      }
    }
    if (isRetriable(error)) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'error',
        detail: `transient error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return {
      operationId,
      status: 'FAIL',
      driftType: 'endpoint_removed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Verify all sites sequentially with rate limiting.
 */
export async function verifyAll(deps?: ExecuteDependencies): Promise<SiteVerifyResult[]> {
  const sites = await listSites()
  const results: SiteVerifyResult[] = []

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!
    results.push(await verifySite(site, deps))
    // Rate limit: 500ms delay between sites
    if (i < sites.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return results
}

/**
 * Check if any site result represents a non-passing state (for exit codes).
 */
export function hasNonPassResults(results: SiteVerifyResult[]): boolean {
  return results.some((r) => r.overallStatus !== 'PASS')
}

/**
 * Generate a drift report as JSON.
 */
export function generateDriftReport(results: SiteVerifyResult[]): object {
  const nonPassSites = results.filter((r) => r.overallStatus !== 'PASS')
  return {
    timestamp: new Date().toISOString(),
    total_sites: results.length,
    passed: results.filter((r) => r.overallStatus === 'PASS').length,
    drifted: results.filter((r) => r.overallStatus === 'DRIFT').length,
    auth_expired: results.filter((r) => r.overallStatus === 'auth_expired').length,
    failed: results.filter((r) => r.overallStatus === 'FAIL').length,
    sites: nonPassSites.map((r) => ({
      site: r.site,
      status: r.overallStatus,
      quarantined: r.shouldQuarantine,
      operations: r.operations
        .filter((o) => o.status !== 'PASS')
        .map((o) => ({
          operation: o.operationId,
          status: o.status,
          drift_type: o.driftType,
          detail: o.detail,
        })),
    })),
  }
}

/**
 * Generate a drift report as markdown.
 */
export function generateDriftReportMarkdown(results: SiteVerifyResult[]): string {
  const lines: string[] = ['# Drift Report', '']
  const ts = new Date().toISOString()
  const passed = results.filter((r) => r.overallStatus === 'PASS').length
  const drifted = results.filter((r) => r.overallStatus === 'DRIFT').length
  const authExpired = results.filter((r) => r.overallStatus === 'auth_expired').length
  const failed = results.filter((r) => r.overallStatus === 'FAIL').length

  lines.push(`**Date:** ${ts}`)
  lines.push(`**Sites:** ${results.length} total | ${passed} passed | ${drifted} drifted | ${authExpired} auth_expired | ${failed} failed`)
  lines.push('')

  for (const r of results) {
    if (r.overallStatus === 'PASS') continue
    const icon = r.overallStatus === 'DRIFT' ? '⚠️' : r.overallStatus === 'auth_expired' ? '🔒' : '❌'
    lines.push(`## ${icon} ${r.site} — ${r.overallStatus}`)
    if (r.shouldQuarantine) lines.push('**Quarantined**')
    lines.push('')
    lines.push('| Operation | Status | Type | Detail |')
    lines.push('|-----------|--------|------|--------|')
    for (const o of r.operations) {
      if (o.status === 'PASS') continue
      lines.push(`| ${o.operationId} | ${o.status} | ${o.driftType ?? ''} | ${o.detail ?? ''} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Fingerprint serialization ──────────────────────
// Store per-operation fingerprints as "opId:hash,opId:hash" in the single response_shape_hash field

function parseStoredFingerprints(serialized: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!serialized.includes(':')) return map
  for (const entry of serialized.split(',')) {
    const [opId, hash] = entry.split(':')
    if (opId && hash) map.set(opId, hash)
  }
  return map
}

function serializeFingerprints(map: Map<string, string>): string {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([opId, hash]) => `${opId}:${hash}`)
    .join(',')
}
