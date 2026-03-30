import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { executeOperation, type ExecuteDependencies } from '../runtime/executor.js'
import { listSites, resolveSiteRoot, loadOpenApi, listOperations, pathExists } from '../lib/openapi.js'
import { OpenWebError } from '../lib/errors.js'
import { computeResponseFingerprint } from './fingerprint.js'
import { loadManifest, saveManifest } from '../lib/manifest.js'
import type { Manifest } from '../types/manifest.js'
import { loadAsyncApi, type AsyncApiSpec } from '../lib/asyncapi.js'
import { WsConnectionPool } from '../runtime/ws-pool.js'
import { openWsSession } from '../runtime/ws-runtime.js'
import { executeWsOperation, streamWsOperation } from '../runtime/ws-executor.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'

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

interface HttpTestCase {
  readonly input: Record<string, unknown>
  readonly assertions: {
    readonly status: number
    readonly response_schema_valid?: boolean
  }
}

interface WsTestAssertion {
  readonly connected?: boolean
  readonly first_message_within_ms?: number
  readonly message_schema_valid?: boolean
}

interface WsTestCase {
  readonly input: Record<string, unknown>
  readonly timeout_ms?: number
  readonly assertions: WsTestAssertion
}

interface HttpTestFile {
  readonly operation_id: string
  readonly protocol?: 'http'
  readonly method?: string
  readonly replay_safety?: 'safe_read' | 'unsafe_mutation'
  readonly cases: HttpTestCase[]
}

interface WsTestFile {
  readonly operation_id: string
  readonly protocol: 'ws'
  readonly mode: 'stream' | 'unary'
  readonly cases: WsTestCase[]
}

type TestFile = HttpTestFile | WsTestFile

function isAuthDrift(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'needs_login'
}

function isPageMissing(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'needs_page'
}

function isRetriable(error: unknown): boolean {
  return error instanceof OpenWebError && error.payload.failureClass === 'retriable'
}

function resolveReplaySafety(
  testFile: TestFile,
  permissionMap: Map<string, string>,
): 'safe_read' | 'unsafe_mutation' {
  if ('replay_safety' in testFile && testFile.replay_safety) {
    return testFile.replay_safety === 'unsafe_mutation' ? 'unsafe_mutation' : 'safe_read'
  }
  const perm = permissionMap.get(testFile.operation_id)
  if (perm === 'read') return 'safe_read'
  if (perm) return 'unsafe_mutation'
  if (!testFile.method || testFile.method === 'get' || testFile.method === 'head') return 'safe_read'
  return 'unsafe_mutation'
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

  // Build permission lookup for replaySafety resolution (best-effort)
  const permissionMap = new Map<string, string>()
  try {
    const openapi = await loadOpenApi(site)
    for (const ref of listOperations(openapi)) {
      const ext = ref.operation['x-openweb'] as Record<string, unknown> | undefined
      if (ext?.permission) permissionMap.set(ref.operation.operationId, ext.permission as string)
    }
  } catch {
    // No openapi or broken spec — fall back to method-based replaySafety check
  }

  const examplesDir = path.join(siteRoot, 'examples')
  // Backward compat: fall back to legacy 'tests/' directory
  const legacyTestsDir = path.join(siteRoot, 'tests')
  let exampleFiles: string[]
  let activeDir: string
  try {
    exampleFiles = (await readdir(examplesDir)).filter((f) => f.endsWith('.example.json'))
    activeDir = examplesDir
  } catch {
    try {
      exampleFiles = (await readdir(legacyTestsDir)).filter((f) => f.endsWith('.test.json'))
      activeDir = legacyTestsDir
    } catch {
      return { site, operations: [], overallStatus: 'FAIL', shouldQuarantine: false }
    }
  }

  const operations: OperationVerifyResult[] = []

  // Load asyncapi for WS verification
  const hasAsyncApi = await pathExists(path.join(siteRoot, 'asyncapi.yaml'))
  let asyncapi: AsyncApiSpec | undefined
  let wsPool: WsConnectionPool | undefined
  if (hasAsyncApi) {
    try {
      asyncapi = await loadAsyncApi(siteRoot)
      wsPool = new WsConnectionPool()
    } catch { /* asyncapi load failure — WS ops will FAIL individually */ }
  }

  for (const fileName of exampleFiles) {
    const raw = await readFile(path.join(activeDir, fileName), 'utf8')
    const testFile = JSON.parse(raw) as TestFile

    // Skip files with incompatible structure (legacy format without cases array)
    if (!Array.isArray(testFile.cases)) continue

    // Skip unsafe mutations — not safe to replay
    if (testFile.protocol !== 'ws' && resolveReplaySafety(testFile, permissionMap) === 'unsafe_mutation') {
      continue
    }

    if (testFile.protocol === 'ws') {
      for (const testCase of testFile.cases) {
        const result = await verifyWsOperation(
          site,
          testFile.operation_id,
          testFile.mode,
          testCase,
          asyncapi,
          wsPool,
          storedFingerprints.get(testFile.operation_id),
          deps,
        )
        operations.push(result)
      }
      continue
    }

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

  // Clean up WS pool
  wsPool?.destroyAll()

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
  testCase: HttpTestCase,
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
 * Verify a WS operation test case with live connection.
 */
async function verifyWsOperation(
  site: string,
  operationId: string,
  mode: 'stream' | 'unary',
  testCase: WsTestCase,
  asyncapi: AsyncApiSpec | undefined,
  pool: WsConnectionPool | undefined,
  storedFingerprint: string | undefined,
  deps?: ExecuteDependencies,
): Promise<OperationVerifyResult> {
  if (!testCase.assertions) {
    return { operationId, status: 'FAIL', driftType: 'error', detail: `ws/${mode}: missing assertions` }
  }

  if (!asyncapi || !pool) {
    return { operationId, status: 'FAIL', driftType: 'error', detail: 'no asyncapi spec available for WS verification' }
  }

  const timeoutMs = testCase.timeout_ms ?? 10_000

  try {
    const session = await openWsSession(site, asyncapi, testCase.input, pool, deps)
    const { connection, router, poolKey } = session

    // Validate 'connected' assertion
    if (testCase.assertions.connected && connection.getState() !== 'READY') {
      pool.release(poolKey, connection)
      return { operationId, status: 'FAIL', driftType: 'error', detail: 'connection not ready' }
    }

    const op = asyncapi.operations?.[operationId]
    const operation = op?.['x-openweb'] as XOpenWebWsOperation | undefined
    if (!operation) {
      pool.release(poolKey, connection)
      return { operationId, status: 'FAIL', driftType: 'error', detail: `operation ${operationId} not found in asyncapi` }
    }

    let body: unknown

    if (mode === 'unary') {
      // publish: just validate connection, no response needed
      if (operation.pattern === 'publish') {
        if (operation.subscribe_message) {
          const { resolveTemplate } = await import('../runtime/ws-executor.js')
          const outgoing = resolveTemplate(operation.subscribe_message, testCase.input, connection.connectionState)
          connection.send(outgoing)
        }
        pool.release(poolKey, connection)
        return { operationId, status: 'PASS' }
      }

      // request_reply
      const result = await executeWsOperation(connection, router, operation, testCase.input, { timeoutMs })
      pool.release(poolKey, connection)
      if (result.status === 'timeout') {
        return { operationId, status: 'FAIL', driftType: 'error', detail: 'request timed out' }
      }
      body = result.body
    } else {
      // Stream: wait for first message within deadline
      const deadline = testCase.assertions.first_message_within_ms ?? timeoutMs
      const handle = streamWsOperation(connection, router, operation, testCase.input, operationId)
      const first = await raceTimeout(handle.messages[Symbol.asyncIterator]().next(), deadline)
      handle.close()
      pool.release(poolKey, connection)

      if (!first || first.done) {
        return { operationId, status: 'FAIL', driftType: 'error', detail: `no message within ${deadline}ms` }
      }
      body = first.value
    }

    // Fingerprint comparison
    const newFingerprint = computeResponseFingerprint(body)
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
      return { operationId, status: 'FAIL', driftType: 'auth_drift', detail: 'WS auth failed' }
    }
    return { operationId, status: 'FAIL', driftType: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])
}

/**
 * Verify all sites sequentially with rate limiting.
 */
export async function verifyAll(deps?: ExecuteDependencies): Promise<SiteVerifyResult[]> {
  const sites = await listSites()
  const results: SiteVerifyResult[] = []

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    if (!site) continue
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
