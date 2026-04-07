import type { Browser } from 'patchright'

import { OpenWebError } from '../lib/errors.js'
import {
  type SiteOverallStatus,
  type VerifyOptions,
  generateDriftReport,
  generateDriftReportMarkdown,
  generateVerifyReport,
  hasNonPassResults,
  verifyAll,
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

export interface VerifyCommandOptions {
  readonly site?: string
  readonly all?: boolean
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
  const verifyOpts: VerifyOptions | undefined = opts.write ? { includeWrite: true } : undefined

  if (opts.write) {
    process.stderr.write('⚠ --write enabled: replaying write/delete operations (transact excluded)\n')
  }

  try {
    if (opts.all) {
      const results = await verifyAll(deps, verifyOpts)

      for (const r of results) {
        const icon = statusIcon(r.overallStatus)
        const q = r.shouldQuarantine ? ' ⚠️ quarantined' : ''
        process.stdout.write(`${icon} ${r.site}: ${r.overallStatus}${q}\n`)
        for (const o of r.operations) {
          if (o.status === 'PASS') continue
          process.stdout.write(`  ${statusIcon(o.status)} ${o.operationId}: ${o.status} — ${o.detail ?? ''}\n`)
        }
      }

      const passed = results.filter((r) => r.overallStatus === 'PASS').length
      const drifted = results.filter((r) => r.overallStatus === 'DRIFT').length
      const authExpired = results.filter((r) => r.overallStatus === 'auth_expired').length
      const botBlocked = results.filter((r) => r.overallStatus === 'bot_blocked').length
      const failed = results.filter((r) => r.overallStatus === 'FAIL').length
      process.stdout.write(`\n${passed} passed, ${drifted} drifted, ${authExpired} auth_expired, ${botBlocked} bot_blocked, ${failed} failed (${results.length} total)\n`)

      if (opts.report) {
        const format = typeof opts.report === 'string' ? opts.report : 'json'
        if (format === 'markdown') {
          process.stdout.write(`\n${generateDriftReportMarkdown(results)}\n`)
        } else {
          process.stdout.write(`\n${JSON.stringify(generateDriftReport(results), null, 2)}\n`)
        }
      }

      if (hasNonPassResults(results)) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `${drifted} drifted, ${authExpired} auth_expired, ${failed} failed`,
          action: 'Run `openweb verify --all --report` for details.',
          retriable: false,
          failureClass: 'fatal',
        })
      }

      return
    }

    if (opts.site) {
      const result = await verifySite(opts.site, deps, verifyOpts)
      const icon = statusIcon(result.overallStatus)
      const q = result.shouldQuarantine ? ' ⚠️ quarantined' : ''
      process.stdout.write(`${icon} ${result.site}: ${result.overallStatus}${q}\n`)
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
