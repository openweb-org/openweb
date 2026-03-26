import type { Browser } from 'playwright-core'

import type { AnalyzedOperation } from './types.js'
import type { ClassifyResult } from './analyzer/classify.js'
import { validateSSRF } from '../lib/ssrf.js'
import { TIMEOUT, PROBE_CONCURRENCY } from '../lib/config.js'
import { logger } from '../lib/logger.js'
import { fetchWithRedirects } from '../runtime/redirect.js'

export interface ProbeResult {
  readonly operationId: string
  readonly transport: 'node' | 'page'
  readonly authRequired: boolean
  readonly status: number
  readonly probeMethod: 'node_no_auth' | 'node_with_auth' | 'page'
}

export interface ProbeOptions {
  readonly browser?: Browser
  readonly cdpEndpoint?: string
  readonly timeout?: number
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

const PROBE_TIMEOUT = TIMEOUT.probe
const MAX_OUTBOUND_REQUESTS = 30

/** Fetch with per-hop SSRF validation, cross-origin header stripping, and timeout */
async function probeFetch(
  url: string,
  headers: Record<string, string>,
  options: ProbeOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  const ssrfValidator = options.ssrfValidator ?? validateSSRF
  const timeout = options.timeout ?? PROBE_TIMEOUT

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    // Wrap fetchImpl to inject abort signal
    const wrappedFetch: typeof fetch = (input, init) =>
      fetchImpl(input, { ...init, signal: controller.signal })
    return await fetchWithRedirects(url, 'GET', headers, undefined, {
      fetchImpl: wrappedFetch,
      ssrfValidator,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Probe a single GET operation through the escalation ladder. Returns [result, requestCount]. */
async function probeOne(
  operation: AnalyzedOperation,
  browser: Browser | undefined,
  options: ProbeOptions,
  remainingBudget: number,
): Promise<[ProbeResult | null, number]> {
  // Only probe GET — mutations are not safe to replay
  if (operation.method.toLowerCase() !== 'get') return [null, 0]
  if (remainingBudget <= 0) return [null, 0]

  const url = `https://${operation.host}${operation.path}`
  let requestsMade = 0

  // Step 1: node no auth
  try {
    requestsMade++
    const response = await probeFetch(url, { Accept: 'application/json' }, options)

    if (response.ok) {
      return [{
        operationId: operation.operationId,
        transport: 'node',
        authRequired: false,
        status: response.status,
        probeMethod: 'node_no_auth',
      }, requestsMade]
    }

    if (response.status === 401 || response.status === 403) {
      // Needs auth — try step 2
    } else {
      // Other error (404, 500, etc.) — can't determine, skip
      return [null, requestsMade]
    }
  } catch {
    // Network error, SSRF block, timeout — can't determine
    return [null, requestsMade]
  }

  // Step 2: node with auth (browser cookies)
  if (browser && remainingBudget - requestsMade > 0) {
    try {
      const context = browser.contexts()[0]
      if (context) {
        const cookies = await context.cookies()
        const cookieStr = cookies
          .filter((c) => {
            try {
              const urlHost = new URL(url).hostname
              const cookieDomain = c.domain.replace(/^\./, '')
              return urlHost === cookieDomain || urlHost.endsWith(`.${cookieDomain}`)
            } catch { return false } // intentional: URL parse failure in cookie filter
          })
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')

        if (cookieStr) {
          requestsMade++
          const response = await probeFetch(
            url,
            { Accept: 'application/json', Cookie: cookieStr },
            options,
          )

          if (response.ok) {
            return [{
              operationId: operation.operationId,
              transport: 'node',
              authRequired: true,
              status: response.status,
              probeMethod: 'node_with_auth',
            }, requestsMade]
          }
        }
      }
    } catch (err) {
      logger.debug(`browser cookie extraction failed for ${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return [null, requestsMade]
}

/**
 * Probe GET operations to validate classify heuristics.
 * Uses bounded concurrency to probe multiple operations in parallel.
 * Returns results only for operations that were successfully probed.
 */
export async function probeOperations(
  operations: AnalyzedOperation[],
  options: ProbeOptions = {},
): Promise<ProbeResult[]> {
  const getOps = operations.filter((op) => op.method.toLowerCase() === 'get')
  if (getOps.length === 0) return []

  const results: ProbeResult[] = []
  let totalRequests = 0
  let cursor = 0

  async function runNext(): Promise<void> {
    while (cursor < getOps.length && totalRequests < MAX_OUTBOUND_REQUESTS) {
      const idx = cursor++
      const op = getOps[idx]
      const remaining = MAX_OUTBOUND_REQUESTS - totalRequests
      if (remaining <= 0) break

      const [result, requestsMade] = await probeOne(op, options.browser, options, remaining)
      totalRequests += requestsMade
      if (result) results.push(result)
    }
  }

  const concurrency = Math.min(PROBE_CONCURRENCY, getOps.length)
  await Promise.all(Array.from({ length: concurrency }, () => runNext()))

  return results
}

/**
 * Merge probe results with classify heuristics.
 * Fail-closed: probe only overrides transport, never drops auth.
 * Since mutations are never probed, auth must be preserved from classify.
 */
export function mergeProbeResults(
  classify: ClassifyResult,
  probes: ProbeResult[],
): ClassifyResult {
  if (probes.length === 0) return classify

  // Determine transport: if all successful probes used node, override to node
  const allNode = probes.every((p) => p.transport === 'node')

  return {
    ...classify,
    transport: allNode ? 'node' : classify.transport,
    // Auth is always preserved — probes only cover GET, mutations may still need auth
  }
}
