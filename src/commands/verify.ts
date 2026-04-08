import type { Browser } from 'patchright'

import { OpenWebError } from '../lib/errors.js'
import { listSites } from '../lib/site-resolver.js'
import {
  type SiteOverallStatus,
  type SiteVerifyResult,
  type VerifyOptions,
  generateVerifyReport,
  hasNonPassResults,
  verifySite,
  writeVerifyReport,
} from '../lifecycle/verify.js'
import { type BrowserHandle, ensureBrowser, touchLastUsed } from '../runtime/browser-lifecycle.js'

function statusIcon(status: SiteOverallStatus): string {
  switch (status) {
    case 'PASS': return '✓'
    case 'DRIFT': return '△'
    case 'FAIL': return '✗'
    case 'auth_expired': return '🔒'
    case 'bot_blocked': return '🤖'
  }
}

function printSiteResult(r: SiteVerifyResult): void {
  const icon = statusIcon(r.overallStatus)
  const opsTotal = r.operations.length
  const opsPass = r.operations.filter((o) => o.status === 'PASS').length
  const q = r.shouldQuarantine ? ' ⚠️ quarantined' : ''
  process.stdout.write(`${icon} ${r.site}: ${r.overallStatus} (${opsPass}/${opsTotal} ops)${q}\n`)
  for (const o of r.operations) {
    if (o.status === 'PASS') continue
    process.stdout.write(`  ${statusIcon(o.status)} ${o.operationId}: ${o.status} — ${o.detail ?? ''}\n`)
  }
}

function printSummary(results: SiteVerifyResult[]): void {
  const passed = results.filter((r) => r.overallStatus === 'PASS').length
  const drifted = results.filter((r) => r.overallStatus === 'DRIFT').length
  const authExpired = results.filter((r) => r.overallStatus === 'auth_expired').length
  const botBlocked = results.filter((r) => r.overallStatus === 'bot_blocked').length
  const failed = results.filter((r) => r.overallStatus === 'FAIL').length
  process.stdout.write(`\n${passed} passed, ${drifted} drifted, ${authExpired} auth_expired, ${botBlocked} bot_blocked, ${failed} failed (${results.length} total)\n`)
}

export interface VerifyCommandOptions {
  readonly site?: string
  readonly all?: boolean
  readonly ops?: string[]
  readonly browser?: boolean
  readonly report?: boolean | string
  readonly write?: boolean
}

export async function verifyCommand(opts: VerifyCommandOptions): Promise<void> {
  let handle: BrowserHandle | undefined
  let browser: Browser | undefined
  let keepAlive: ReturnType<typeof setInterval> | undefined
  if (opts.browser) {
    handle = await ensureBrowser()
    browser = handle.browser
    keepAlive = setInterval(() => touchLastUsed().catch(() => {}), 60_000)
  }

  const deps = browser ? { browser } : undefined
  const verifyOpts: VerifyOptions | undefined = (opts.write || opts.ops)
    ? { includeWrite: opts.write, ops: opts.ops }
    : undefined

  if (opts.write) {
    process.stderr.write('⚠ --write enabled: replaying write/delete operations (transact excluded)\n')
  }

  try {
    if (opts.all) {
      const sites = await listSites()
      const results: SiteVerifyResult[] = []

      for (let i = 0; i < sites.length; i++) {
        const site = sites[i]
        if (!site) continue

        const result = await verifySite(site, deps, verifyOpts)
        results.push(result)

        // Stream to terminal
        printSiteResult(result)

        // Stream to report file — overwrite with current progress after each site
        const report = generateVerifyReport(results)
        await writeVerifyReport(report).catch(() => {})

        // Rate limit between sites
        if (i < sites.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }

      // Final summary
      printSummary(results)

      const report = generateVerifyReport(results)
      const reportPath = await writeVerifyReport(report)
      process.stderr.write(`Report saved: ${reportPath}\n`)

      if (opts.report) {
        process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
      }

      if (hasNonPassResults(results)) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `${report.summary.drifted} drifted, ${report.summary.auth_expired} auth_expired, ${report.summary.failed} failed`,
          action: `See report: ${reportPath}`,
          retriable: false,
          failureClass: 'fatal',
        })
      }

      return
    }

    if (opts.site) {
      const result = await verifySite(opts.site, deps, verifyOpts)
      const icon = statusIcon(result.overallStatus)
      const opsTotal = result.operations.length
      const opsPass = result.operations.filter((o) => o.status === 'PASS').length
      const q = result.shouldQuarantine ? ' ⚠️ quarantined' : ''
      process.stdout.write(`${icon} ${result.site}: ${result.overallStatus} (${opsPass}/${opsTotal} ops)${q}\n`)
      for (const o of result.operations) {
        process.stdout.write(`  ${statusIcon(o.status)} ${o.operationId}: ${o.status}${o.detail ? ` — ${o.detail}` : ''}\n`)
      }

      if (result.overallStatus !== 'PASS' && result.overallStatus !== 'DRIFT') {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `${result.site}: ${result.overallStatus}`,
          action: 'Inspect the per-operation details above.',
          retriable: false,
          failureClass: 'fatal',
        })
      }

      return
    }

    throw new OpenWebError({
      error: 'execution_failed', code: 'INVALID_PARAMS',
      message: 'Missing site name or --all flag.',
      action: 'Usage: openweb verify <site> or openweb verify --all',
      retriable: false, failureClass: 'fatal',
    })
  } finally {
    if (keepAlive) clearInterval(keepAlive)
    if (handle) {
      await handle.release()
    }
  }
}
