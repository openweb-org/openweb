import type { Browser } from 'playwright'

import type { AnalyzedOperation } from './types.js'
import type { ClassifyResult } from './analyzer/classify.js'
import { validateSSRF } from '../lib/ssrf.js'

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

const PROBE_TIMEOUT = 5000
const PROBE_DELAY = 500
const MAX_TOTAL_PROBES = 30

/** Probe a single GET operation through the escalation ladder */
async function probeOne(
  operation: AnalyzedOperation,
  serverUrl: string,
  browser: Browser | undefined,
  options: ProbeOptions,
): Promise<ProbeResult | null> {
  // Only probe GET — mutations are not safe to replay
  if (operation.method.toLowerCase() !== 'get') return null

  const fetchImpl = options.fetchImpl ?? fetch
  const ssrfValidator = options.ssrfValidator ?? validateSSRF
  const timeout = options.timeout ?? PROBE_TIMEOUT
  const url = `${serverUrl}${operation.path}`

  // Step 1: node no auth
  try {
    await ssrfValidator(url)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (response.ok) {
      return {
        operationId: operation.operationId,
        transport: 'node',
        authRequired: false,
        status: response.status,
        probeMethod: 'node_no_auth',
      }
    }

    if (response.status === 401 || response.status === 403) {
      // Needs auth — try step 2
    } else {
      // Other error (404, 500, etc.) — can't determine, skip
      return null
    }
  } catch {
    // Network error, SSRF block, timeout — can't determine
    return null
  }

  // Step 2: node with auth (browser cookies)
  if (browser) {
    try {
      const context = browser.contexts()[0]
      if (context) {
        const cookies = await context.cookies()
        const cookieStr = cookies
          .filter((c) => {
            try {
              const urlHost = new URL(url).hostname
              const cookieDomain = c.domain.replace(/^\./, '')
              return urlHost === cookieDomain || urlHost.endsWith('.' + cookieDomain)
            } catch { return false }
          })
          .map((c) => `${c.name}=${c.value}`)
          .join('; ')

        if (cookieStr) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          const response = await fetchImpl(url, {
            headers: { Accept: 'application/json', Cookie: cookieStr },
            redirect: 'follow',
            signal: controller.signal,
          })
          clearTimeout(timer)

          if (response.ok) {
            return {
              operationId: operation.operationId,
              transport: 'node',
              authRequired: true,
              status: response.status,
              probeMethod: 'node_with_auth',
            }
          }
        }
      }
    } catch {
      // Browser extraction failed — fall through
    }
  }

  // Step 3: page (browser_fetch) — would need full page.evaluate which is heavy
  // For now, if node_with_auth failed, mark as needing page transport
  // (actual page probing requires a matching tab which we can't guarantee)
  return null
}

/**
 * Probe GET operations to validate classify heuristics.
 * Returns results only for operations that were successfully probed.
 * Operations that couldn't be probed (timeout, error, non-GET) return no result.
 */
export async function probeOperations(
  operations: AnalyzedOperation[],
  serverUrl: string,
  options: ProbeOptions = {},
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  let probeCount = 0

  for (const operation of operations) {
    if (probeCount >= MAX_TOTAL_PROBES) break

    // Skip non-GET early — don't consume probe budget
    if (operation.method.toLowerCase() !== 'get') continue

    const result = await probeOne(operation, serverUrl, options.browser, options)
    if (result) {
      results.push(result)
    }
    probeCount++

    // Rate limit between probes
    if (probeCount < operations.length) {
      await new Promise((r) => setTimeout(r, PROBE_DELAY))
    }
  }

  return results
}

/**
 * Merge probe results with classify heuristics.
 * Probe is ground truth — overrides heuristic when available.
 */
export function mergeProbeResults(
  classify: ClassifyResult,
  probes: ProbeResult[],
): ClassifyResult {
  if (probes.length === 0) return classify

  // Check if any probe succeeded without auth
  const noAuthSuccess = probes.some((p) => !p.authRequired)
  // Check if any probe needed auth
  const authNeeded = probes.some((p) => p.authRequired)

  // Determine transport: if all successful probes used node, keep node
  const allNode = probes.every((p) => p.transport === 'node')

  return {
    ...classify,
    transport: allNode ? 'node' : classify.transport,
    // If probes show no auth needed but classify detected auth, trust the probe
    // (but only if ALL probed operations succeeded without auth)
    auth: noAuthSuccess && !authNeeded ? undefined : classify.auth,
  }
}
