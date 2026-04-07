import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type AsyncApiSpec, loadAsyncApi } from '../lib/asyncapi.js'
import { openwebHome } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'
import { loadManifest, saveManifest } from '../lib/manifest.js'
import { listOperations, listSites, loadOpenApi, pathExists, resolveSiteRoot, findOperation, getResponseSchema } from '../lib/openapi.js'
import { ensureBrowser } from '../runtime/browser-lifecycle.js'
import { type ExecuteDependencies, executeOperation } from '../runtime/executor.js'
import { resolveTransport } from '../runtime/operation-context.js'
import { autoNavigate, findPageForOrigin } from '../runtime/session-executor.js'
import { executeWsOperation, streamWsOperation } from '../runtime/ws-executor.js'
import { WsConnectionPool } from '../runtime/ws-pool.js'
import { openWsSession } from '../runtime/ws-runtime.js'
import type { Manifest } from '../types/manifest.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'
import { type DriftResult, diffShape, extractFields, extractRequiredFields, extractSchemaFields } from './shape-diff.js'

export type DriftType = 'schema_drift' | 'auth_drift' | 'bot_detection' | 'endpoint_removed' | 'error'

export type OperationStatus = 'PASS' | 'DRIFT' | 'FAIL'

/** Site-level overall status — includes 'auth_expired' and 'bot_blocked' for non-quarantine failures. */
export type SiteOverallStatus = OperationStatus | 'auth_expired' | 'bot_blocked'

export interface VerifyOptions {
  readonly includeWrite?: boolean
  /** Per-operation timeout in milliseconds. Default: 45_000 */
  readonly operationTimeoutMs?: number
  /** Only verify these operation IDs (skip all others) */
  readonly ops?: string[]
}

/** Default per-operation timeout (45 seconds). Prevents hangs from login prompts or slow endpoints. */
const DEFAULT_OP_TIMEOUT_MS = 45_000

export interface OperationVerifyResult {
  readonly operationId: string
  readonly status: OperationStatus
  readonly driftType?: DriftType
  readonly detail?: string
  readonly drifts?: readonly DriftResult[]
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

function isBotDetection(error: unknown): boolean {
  return error instanceof OpenWebError
    && error.payload.failureClass === 'bot_blocked'
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return JSON.stringify(err)
}

// TODO: Add 'safe_mutation' for idempotent/reversible writes (like, follow, bookmark)
// that are safe to replay during verify. Currently all non-read ops are unsafe_mutation.
// See doc/todo/verify-unify/design.md "Future: safe_mutation and --write flag"
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
 * Verify a single site: run all test cases, check structural drift.
 */
export async function verifySite(
  site: string,
  deps?: ExecuteDependencies,
  options?: VerifyOptions,
): Promise<SiteVerifyResult> {
  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)

  // Build permission lookup for replaySafety resolution (best-effort)
  const permissionMap = new Map<string, string>()
  let needsBrowser = false
  let siteBaseUrl = ''
  let openapi: import('../lib/spec-loader.js').OpenApiSpec | undefined
  try {
    openapi = await loadOpenApi(site)
    for (const ref of listOperations(openapi)) {
      const ext = ref.operation['x-openweb'] as Record<string, unknown> | undefined
      if (ext?.permission) permissionMap.set(ref.operation.operationId, ext.permission as string)
      if (!needsBrowser) {
        const hasAdapter = !!ext?.adapter
        const transport = resolveTransport(openapi, ref.operation)
        if (hasAdapter || transport === 'page') {
          needsBrowser = true
          const serverUrl = ref.operation.servers?.[0]?.url ?? openapi.servers?.[0]?.url ?? ''
          const serverExt = (ref.operation.servers?.[0]?.['x-openweb'] ?? openapi.servers?.[0]?.['x-openweb']) as Record<string, unknown> | undefined
          const warmupPath = serverExt?.warmup_path as string | undefined
          siteBaseUrl = warmupPath ? `${serverUrl.replace(/\/$/, '')}${warmupPath}` : serverUrl
        }
      }
    }
  } catch {
    // No openapi or broken spec — fall back to method-based replaySafety check
  }

  // Warm-up: navigate to site base URL so page/adapter ops find a matching tab
  if (needsBrowser && siteBaseUrl) {
    try {
      const handle = deps?.browser ? undefined : await ensureBrowser(deps?.cdpEndpoint)
      const browser = deps?.browser ?? handle?.browser
      if (!browser) throw new Error('no browser')
      try {
        const context = browser.contexts()[0]
        if (context) {
          const existing = await findPageForOrigin(context, siteBaseUrl)
          if (!existing) {
            await autoNavigate(context, siteBaseUrl)
          }
        }
      } finally {
        if (handle) await handle.release()
      }
    } catch { /* warm-up is best-effort — don't fail verify */ }
  }

  const examplesDir = path.join(siteRoot, 'examples')
  let exampleFiles: string[]
  try {
    exampleFiles = (await readdir(examplesDir)).filter((f) => f.endsWith('.example.json'))
  } catch {
    return { site, operations: [], overallStatus: 'FAIL', shouldQuarantine: false }
  }

  const operations: OperationVerifyResult[] = []
  const opTimeoutMs = options?.operationTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS

  // Track login attempts per site — after the first needs_login failure,
  // skip the login cascade for remaining ops to avoid infinite login loops.
  let loginAttempted = false

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
    const raw = await readFile(path.join(examplesDir, fileName), 'utf8')
    const testFile = JSON.parse(raw) as TestFile

    // Filter by --ops if specified
    if (options?.ops && !options.ops.includes(testFile.operation_id)) continue

    // Skip files with incompatible structure (legacy format without cases array)
    if (!Array.isArray(testFile.cases)) {
      const opId = testFile.operation_id ?? fileName.replace('.example.json', '')
      operations.push({
        operationId: opId,
        status: 'FAIL',
        driftType: 'error',
        detail: 'malformed example file: missing cases array',
      })
      continue
    }

    // Skip unsafe mutations — not safe to replay
    if (testFile.protocol !== 'ws' && resolveReplaySafety(testFile, permissionMap) === 'unsafe_mutation') {
      if (!options?.includeWrite) continue
      // Even with --write, never replay transact ops
      const perm = permissionMap.get(testFile.operation_id)
      if (perm === 'transact') continue
    }

    if (testFile.protocol === 'ws') {
      for (const testCase of testFile.cases) {
        const result = await withOpTimeout(
          verifyWsOperation(
            site,
            testFile.operation_id,
            testFile.mode,
            testCase,
            asyncapi,
            wsPool,
            deps,
          ),
          testFile.operation_id,
          opTimeoutMs,
        )
        if (result.driftType === 'auth_drift') loginAttempted = true
        operations.push(result)
      }
      continue
    }

    for (const testCase of testFile.cases) {
      const effectiveDeps = loginAttempted ? { ...deps, skipLoginCascade: true } : deps
      const result = await withOpTimeout(
        verifyOperation(
          site,
          testFile.operation_id,
          testCase,
          openapi,
          effectiveDeps,
        ),
        testFile.operation_id,
        opTimeoutMs,
      )
      if (result.driftType === 'auth_drift') loginAttempted = true
      operations.push(result)
    }
  }

  // Close pages opened for this site's origin (warm-up + any leaked by timeouts)
  if (needsBrowser && siteBaseUrl) {
    try {
      const handle = deps?.browser ? undefined : await ensureBrowser(deps?.cdpEndpoint)
      const browser = deps?.browser ?? handle?.browser
      try {
        const context = browser?.contexts()[0]
        if (context) {
          const origin = new URL(siteBaseUrl).origin
          for (const p of context.pages()) {
            try {
              if (new URL(p.url()).origin === origin) await p.close().catch(() => {})
            } catch { /* detached page */ }
          }
        }
      } finally {
        if (handle) await handle.release()
      }
    } catch { /* cleanup is best-effort */ }
  }

  // Clean up WS pool
  wsPool?.destroyAll()

  // Determine overall status
  const hasDrift = operations.some((o) => o.status === 'DRIFT')
  const hasRealFail = operations.some((o) => o.status === 'FAIL' && o.driftType !== 'auth_drift' && o.driftType !== 'bot_detection')
  const hasAuthDrift = operations.some((o) => o.driftType === 'auth_drift')
  const hasBotBlock = operations.some((o) => o.driftType === 'bot_detection')
  const hasPass = operations.some((o) => o.status === 'PASS')

  let overallStatus: SiteOverallStatus
  if (hasRealFail) {
    overallStatus = 'FAIL'
  } else if (hasDrift) {
    overallStatus = 'DRIFT'
  } else if (hasAuthDrift) {
    // ANY auth_drift taints the result — even if some ops passed
    overallStatus = 'auth_expired'
  } else if (hasBotBlock) {
    overallStatus = 'bot_blocked'
  } else if (hasPass) {
    overallStatus = 'PASS'
  } else {
    overallStatus = 'FAIL'
  }

  // Quarantine on real failures — NOT on auth_expired, bot_blocked, or PASS
  const shouldQuarantine = hasRealFail

  // Update manifest with verification results
  if (manifest) {
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
  openapi: import('../lib/spec-loader.js').OpenApiSpec | undefined,
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

    // Structural diff: compare response shape against OpenAPI schema
    if (openapi && result.body != null) {
      try {
        const opRef = findOperation(openapi, operationId)
        const responseSchema = getResponseSchema(opRef.operation)
        if (responseSchema) {
          const responseFields = extractFields(result.body)
          const schemaFields = extractSchemaFields(responseSchema)
          const requiredFields = extractRequiredFields(responseSchema)
          const drifts = diffShape(schemaFields, responseFields, requiredFields)
          if (drifts.length > 0) {
            return {
              operationId,
              status: 'DRIFT',
              driftType: 'schema_drift',
              detail: drifts.map((d) => `${d.kind}:${d.path}`).join(', '),
              drifts,
            }
          }
        }
      } catch {
        // Schema lookup failed — skip structural diff, still PASS
      }
    }

    return { operationId, status: 'PASS' }
  } catch (error) {
    if (isAuthDrift(error)) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'auth_drift',
        detail: 'authentication expired (401/403)',
      }
    }
    if (isBotDetection(error)) {
      return {
        operationId,
        status: 'FAIL',
        driftType: 'bot_detection',
        detail: 'bot detection blocked (CAPTCHA challenge)',
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
        detail: `transient error: ${formatErrorMessage(error)}`,
      }
    }
    return {
      operationId,
      status: 'FAIL',
      driftType: 'endpoint_removed',
      detail: formatErrorMessage(error),
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

    // WS operations: no structural diff yet (no schema source), just PASS
    return { operationId, status: 'PASS' }
  } catch (error) {
    if (isAuthDrift(error)) {
      return { operationId, status: 'FAIL', driftType: 'auth_drift', detail: 'WS auth failed' }
    }
    return { operationId, status: 'FAIL', driftType: 'error', detail: formatErrorMessage(error) }
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])
}

/**
 * Wrap a verify operation promise with a timeout. If the operation takes
 * longer than `ms`, returns a FAIL result instead of hanging indefinitely.
 */
function withOpTimeout(
  promise: Promise<OperationVerifyResult>,
  operationId: string,
  ms: number,
): Promise<OperationVerifyResult> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<OperationVerifyResult>((resolve) => {
      timer = setTimeout(() => resolve({
        operationId,
        status: 'FAIL',
        driftType: 'error',
        detail: `operation timed out after ${Math.round(ms / 1000)}s`,
      }), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Verify all sites sequentially with rate limiting.
 */
export async function verifyAll(deps?: ExecuteDependencies, options?: VerifyOptions): Promise<SiteVerifyResult[]> {
  const sites = await listSites()
  const results: SiteVerifyResult[] = []

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    if (!site) continue
    results.push(await verifySite(site, deps, options))
    // Rate limit: 500ms delay between sites
    if (i < sites.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return results
}

/**
 * Check if any site result represents a failing state (for exit codes).
 * DRIFT is advisory — only FAIL, auth_expired, and bot_blocked are non-pass.
 */
export function hasNonPassResults(results: SiteVerifyResult[]): boolean {
  return results.some((r) => r.overallStatus !== 'PASS' && r.overallStatus !== 'DRIFT')
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
    bot_blocked: results.filter((r) => r.overallStatus === 'bot_blocked').length,
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
  const botBlocked = results.filter((r) => r.overallStatus === 'bot_blocked').length
  const failed = results.filter((r) => r.overallStatus === 'FAIL').length

  lines.push(`**Date:** ${ts}`)
  lines.push(`**Sites:** ${results.length} total | ${passed} passed | ${drifted} drifted | ${authExpired} auth_expired | ${botBlocked} bot_blocked | ${failed} failed`)
  lines.push('')

  for (const r of results) {
    if (r.overallStatus === 'PASS') continue
    const icon = r.overallStatus === 'DRIFT' ? '⚠️' : r.overallStatus === 'auth_expired' ? '🔒' : r.overallStatus === 'bot_blocked' ? '🤖' : '❌'
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

// ── Verify report persistence ──────────────────────

export interface VerifyReport {
  readonly timestamp: string
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly drifted: number
    readonly auth_expired: number
    readonly bot_blocked: number
    readonly failed: number
  }
  readonly sites: readonly {
    readonly site: string
    readonly status: SiteOverallStatus
    readonly quarantined: boolean
    readonly duration_ms?: number
    readonly operations: readonly {
      readonly operation: string
      readonly status: OperationStatus
      readonly drift_type?: DriftType
      readonly detail?: string
    }[]
  }[]
}

export function generateVerifyReport(results: SiteVerifyResult[], durations?: Map<string, number>): VerifyReport {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.overallStatus === 'PASS').length,
      drifted: results.filter((r) => r.overallStatus === 'DRIFT').length,
      auth_expired: results.filter((r) => r.overallStatus === 'auth_expired').length,
      bot_blocked: results.filter((r) => r.overallStatus === 'bot_blocked').length,
      failed: results.filter((r) => r.overallStatus === 'FAIL').length,
    },
    sites: results.map((r) => ({
      site: r.site,
      status: r.overallStatus,
      quarantined: r.shouldQuarantine,
      ...(durations?.get(r.site) != null ? { duration_ms: durations.get(r.site) } : {}),
      operations: r.operations.map((o) => ({
        operation: o.operationId,
        status: o.status,
        ...(o.driftType ? { drift_type: o.driftType } : {}),
        ...(o.detail ? { detail: o.detail } : {}),
      })),
    })),
  }
}

export async function writeVerifyReport(report: VerifyReport): Promise<string> {
  const dir = openwebHome()
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, 'verify-report.json')
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf8')
  return filePath
}
