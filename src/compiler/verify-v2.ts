/**
 * Unified verify system (v2).
 *
 * Replaces both verifyOperation() and probeOperations() with a single
 * auth-first escalation strategy and per-attempt diagnostics.
 */

import type { ParameterDescriptor } from './types.js'
import type { VerifyAttempt, VerifyReason, VerifyReport, VerifyResult } from './types-v2.js'
import { buildQueryUrl } from '../lib/openapi.js'
import { fetchWithRedirects, type RedirectOptions } from '../runtime/redirect.js'
import { validateSSRF } from '../lib/ssrf.js'
import { TIMEOUT } from '../lib/config.js'

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface VerifyOperationInput {
  readonly operationId: string
  readonly method: string
  readonly host: string
  readonly pathTemplate: string
  readonly parameters: readonly ParameterDescriptor[]
  readonly exampleInput: Record<string, unknown>
  readonly replaySafety: 'safe_read' | 'unsafe_mutation'
}

export interface VerifyInput {
  readonly operations: readonly VerifyOperationInput[]
  readonly auth?: {
    readonly cookies?: string
  }
  readonly timeoutMs?: number
  readonly concurrency?: number
  /** Injected fetch for testing — defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Injected SSRF validator for testing — defaults to validateSSRF. */
  readonly ssrfValidator?: (url: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Bounded parallel helper (same pattern as compile.ts)
// ---------------------------------------------------------------------------

async function boundedParallel<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = []
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      // biome-ignore lint/style/noNonNullAssertion: index always in bounds
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

// ---------------------------------------------------------------------------
// Reason classification
// ---------------------------------------------------------------------------

function reasonFromStatus(status: number): VerifyReason {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'auth_required'
  if (status >= 400 && status < 500) return 'client_error'
  return 'server_error'
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType.includes('json')
}

// ---------------------------------------------------------------------------
// Single-attempt fetch
// ---------------------------------------------------------------------------

interface AttemptInput {
  readonly url: string
  readonly method: string
  readonly mode: 'with_auth' | 'without_auth'
  readonly cookies?: string
  readonly timeoutMs: number
  readonly fetchImpl: typeof fetch
  readonly ssrfValidator: (url: string) => Promise<void>
}

async function attempt(input: AttemptInput): Promise<VerifyAttempt> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.mode === 'with_auth' && input.cookies) {
    headers.Cookie = input.cookies
  }

  const wrappedFetch: typeof fetch = (reqInput, init) =>
    input.fetchImpl(reqInput, { ...init, signal: controller.signal })

  const redirectOpts: RedirectOptions = {
    fetchImpl: wrappedFetch,
    ssrfValidator: input.ssrfValidator,
  }

  try {
    const response = await fetchWithRedirects(
      input.url,
      input.method.toUpperCase(),
      headers,
      undefined,
      redirectOpts,
    )

    clearTimeout(timer)
    const contentType = response.headers.get('content-type')
    const status = response.status
    const durationMs = Date.now() - start

    if (status >= 200 && status < 300 && !isJsonContentType(contentType)) {
      return { mode: input.mode, transport: 'node', statusCode: status, durationMs, reason: 'non_json_response', contentType: contentType ?? undefined }
    }

    return {
      mode: input.mode,
      transport: 'node',
      statusCode: status,
      durationMs,
      reason: reasonFromStatus(status),
      contentType: contentType ?? undefined,
    }
  } catch (err) {
    clearTimeout(timer)
    const durationMs = Date.now() - start

    if (err instanceof Error && err.name === 'AbortError') {
      return { mode: input.mode, transport: 'node', durationMs, reason: 'timeout' }
    }

    if (err instanceof Error && err.message?.includes('SSRF')) {
      return { mode: input.mode, transport: 'node', durationMs, reason: 'ssrf_blocked' }
    }

    return { mode: input.mode, transport: 'node', durationMs, reason: 'network_error' }
  }
}

// ---------------------------------------------------------------------------
// Per-operation verification with auth-first escalation
// ---------------------------------------------------------------------------

function buildUrl(op: VerifyOperationInput): string {
  return buildQueryUrl(
    `https://${op.host}`,
    op.pathTemplate,
    op.parameters.map((p) => ({
      name: p.name,
      in: p.location,
      required: p.required,
      schema: p.schema,
    })),
    op.exampleInput,
  )
}

async function verifyOne(
  op: VerifyOperationInput,
  input: VerifyInput,
  fetchImpl: typeof fetch,
  ssrfValidator: (url: string) => Promise<void>,
  timeoutMs: number,
): Promise<VerifyResult> {
  // Skip unsafe mutations
  if (op.replaySafety === 'unsafe_mutation') {
    return {
      operationId: op.operationId,
      overall: 'skipped',
      authWorks: null,
      publicWorks: null,
      attempts: [],
    }
  }

  let url: string
  try {
    url = buildUrl(op)
  } catch {
    return {
      operationId: op.operationId,
      overall: 'fail',
      authWorks: null,
      publicWorks: null,
      attempts: [{ mode: 'without_auth', transport: 'node', durationMs: 0, reason: 'missing_example' }],
    }
  }

  const baseAttempt = {
    url,
    method: op.method,
    timeoutMs,
    fetchImpl,
    ssrfValidator,
  }

  const attempts: VerifyAttempt[] = []
  let authWorks: boolean | null = null
  let publicWorks: boolean | null = null

  const hasCookies = Boolean(input.auth?.cookies)

  if (hasCookies) {
    // Step 1: Try with_auth first
    const authAttempt = await attempt({ ...baseAttempt, mode: 'with_auth', cookies: input.auth?.cookies })
    attempts.push(authAttempt)

    if (authAttempt.reason === 'ok') {
      authWorks = true
      // Optionally check if public (without_auth)
      const publicAttempt = await attempt({ ...baseAttempt, mode: 'without_auth' })
      attempts.push(publicAttempt)
      publicWorks = publicAttempt.reason === 'ok'
      return { operationId: op.operationId, overall: 'pass', authWorks, publicWorks, attempts }
    }

    if (authAttempt.reason === 'auth_required') {
      // with_auth got 401/403 — try without_auth
      authWorks = false
      const publicAttempt = await attempt({ ...baseAttempt, mode: 'without_auth' })
      attempts.push(publicAttempt)
      publicWorks = publicAttempt.reason === 'ok'
      const overall = publicWorks ? 'pass' : 'fail'
      return { operationId: op.operationId, overall, authWorks, publicWorks, attempts }
    }

    // 404, 400, timeout, network_error, etc. — stop, don't mask
    authWorks = false
    return { operationId: op.operationId, overall: 'fail', authWorks, publicWorks: null, attempts }
  }

  // No auth — only without_auth
  const publicAttempt = await attempt({ ...baseAttempt, mode: 'without_auth' })
  attempts.push(publicAttempt)
  publicWorks = publicAttempt.reason === 'ok'
  const overall = publicWorks ? 'pass' : 'fail'
  return { operationId: op.operationId, overall, authWorks: null, publicWorks, attempts }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function verifyPackage(input: VerifyInput): Promise<VerifyReport> {
  const timeoutMs = input.timeoutMs ?? TIMEOUT.probe
  const concurrency = input.concurrency ?? 6
  const fetchImpl = input.fetchImpl ?? fetch
  const ssrfValidator = input.ssrfValidator ?? validateSSRF

  const results = await boundedParallel(
    input.operations,
    (op) => verifyOne(op, input, fetchImpl, ssrfValidator, timeoutMs),
    concurrency,
  )

  return {
    generatedAt: new Date().toISOString(),
    results,
  }
}
