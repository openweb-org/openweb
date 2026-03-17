/**
 * Integration test runner — executes real operations against live sites via Chrome CDP.
 * Auth drift (401/403) results in SKIP, not FAIL.
 *
 * Usage: pnpm test:integration [--site <name>]
 */
import { chromium } from 'playwright'

import { executeOperation } from '../../src/runtime/executor.js'
import { OpenWebError } from '../../src/lib/errors.js'
import { sites, type SiteIntegrationTest } from './sites.config.js'

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://localhost:9222'
const SITE_FILTER = process.argv.find((_, i, arr) => arr[i - 1] === '--site')

interface TestResult {
  readonly site: string
  readonly operation: string
  readonly status: 'PASS' | 'SKIP' | 'FAIL'
  readonly detail?: string
}

async function checkCdpAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_ENDPOINT}/json/version`)
    return res.ok
  } catch {
    return false
  }
}

function isAuthDrift(error: unknown): boolean {
  if (error instanceof OpenWebError) {
    const fc = error.payload.failureClass
    return fc === 'needs_login' || fc === 'needs_page'
  }
  return false
}

async function runSmoke(
  config: SiteIntegrationTest,
  browser: import('playwright').Browser,
): Promise<TestResult> {
  try {
    const result = await executeOperation(
      config.site,
      config.smoke.operation,
      config.smoke.params,
      { cdpEndpoint: CDP_ENDPOINT, browser },
    )

    if (result.status >= 200 && result.status < 300) {
      return { site: config.site, operation: config.smoke.operation, status: 'PASS', detail: `HTTP ${result.status}` }
    }

    return { site: config.site, operation: config.smoke.operation, status: 'FAIL', detail: `HTTP ${result.status}` }
  } catch (error) {
    if (isAuthDrift(error)) {
      const msg = error instanceof Error ? error.message : String(error)
      return { site: config.site, operation: config.smoke.operation, status: 'SKIP', detail: `auth expired: ${msg}` }
    }
    const msg = error instanceof Error ? error.message : String(error)
    return { site: config.site, operation: config.smoke.operation, status: 'FAIL', detail: msg }
  }
}

async function main(): Promise<void> {
  const cdpOk = await checkCdpAvailable()
  if (!cdpOk) {
    console.error(`CDP endpoint not reachable at ${CDP_ENDPOINT}`)
    console.error('Start Chrome with: --remote-debugging-port=9222')
    process.exit(1)
  }

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT)
  const filteredSites = SITE_FILTER ? sites.filter((s) => s.site.includes(SITE_FILTER)) : sites

  const results: TestResult[] = []

  for (const config of filteredSites) {
    const result = await runSmoke(config, browser)
    results.push(result)

    const icon = result.status === 'PASS' ? '✓' : result.status === 'SKIP' ? '○' : '✗'
    console.log(`${icon} ${config.site}/${result.operation}: ${result.status}${result.detail ? ` (${result.detail})` : ''}`)
  }

  await browser.close()

  const passed = results.filter((r) => r.status === 'PASS').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  const failed = results.filter((r) => r.status === 'FAIL').length

  console.log('')
  console.log(`Results: ${passed} passed, ${skipped} skipped, ${failed} failed (${results.length} total)`)

  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
