/**
 * Integration test runner — executes real operations against live sites via Chrome CDP.
 * Auth drift (401/403) results in SKIP, not FAIL.
 *
 * Usage: pnpm test:integration [--site <name>]
 */
import { chromium } from 'playwright'

import { executeOperation } from '../../src/runtime/executor.js'
import { executePaginated } from '../../src/runtime/paginator.js'
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
    return error.payload.failureClass === 'needs_login'
  }
  return false
}

function isPageMissing(error: unknown): boolean {
  if (error instanceof OpenWebError) {
    return error.payload.failureClass === 'needs_page'
  }
  return false
}

/** Check if any open tab matches the expected page_url origin */
async function hasMatchingPage(browser: import('playwright').Browser, pageUrl: string): Promise<boolean> {
  try {
    const expectedOrigin = new URL(pageUrl).origin
    const context = browser.contexts()[0]
    if (!context) return false
    for (const page of context.pages()) {
      try {
        const pageOrigin = new URL(page.url()).origin
        if (pageOrigin === expectedOrigin) return true
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
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
    if (isPageMissing(error)) {
      // Verify whether the page is genuinely not open (SKIP) or if page matching is broken (FAIL)
      const tabOpen = await hasMatchingPage(browser, config.page_url)
      if (!tabOpen) {
        return { site: config.site, operation: config.smoke.operation, status: 'SKIP', detail: `no tab open for ${config.page_url}` }
      }
      // Tab is open but page matcher didn't find it — this is a real regression
      const msg = error instanceof Error ? error.message : String(error)
      return { site: config.site, operation: config.smoke.operation, status: 'FAIL', detail: `page_url matched but needs_page: ${msg}` }
    }
    const msg = error instanceof Error ? error.message : String(error)
    return { site: config.site, operation: config.smoke.operation, status: 'FAIL', detail: msg }
  }
}

async function runPagination(
  config: SiteIntegrationTest,
  browser: import('playwright').Browser,
): Promise<TestResult | undefined> {
  if (!config.pagination) return undefined
  try {
    const result = await executePaginated(
      config.site,
      config.pagination.operation,
      config.pagination.params,
      { maxPages: 2, deps: { cdpEndpoint: CDP_ENDPOINT, browser } },
    )
    if (result.pages > 1) {
      return { site: config.site, operation: `${config.pagination.operation} (paginated)`, status: 'PASS', detail: `${result.pages} pages` }
    }
    return { site: config.site, operation: `${config.pagination.operation} (paginated)`, status: 'PASS', detail: '1 page (may be end of data)' }
  } catch (error) {
    if (isAuthDrift(error) || isPageMissing(error)) {
      return { site: config.site, operation: `${config.pagination.operation} (paginated)`, status: 'SKIP', detail: 'auth/page' }
    }
    const msg = error instanceof Error ? error.message : String(error)
    return { site: config.site, operation: `${config.pagination.operation} (paginated)`, status: 'FAIL', detail: msg }
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

    // Run pagination test if smoke passed and config has pagination
    if (result.status === 'PASS' && config.pagination) {
      const pagResult = await runPagination(config, browser)
      if (pagResult) {
        results.push(pagResult)
        const pagIcon = pagResult.status === 'PASS' ? '✓' : pagResult.status === 'SKIP' ? '○' : '✗'
        console.log(`${pagIcon} ${config.site}/${pagResult.operation}: ${pagResult.status}${pagResult.detail ? ` (${pagResult.detail})` : ''}`)
      }
    }
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
