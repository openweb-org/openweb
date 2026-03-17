import {
  verifySite,
  verifyAll,
  hasNonPassResults,
  generateDriftReport,
  generateDriftReportMarkdown,
  type SiteOverallStatus,
} from '../lifecycle/verify.js'
import { healSite, type HealResult } from '../lifecycle/heal.js'
import { OpenWebError } from '../lib/errors.js'

function statusIcon(status: SiteOverallStatus): string {
  switch (status) {
    case 'PASS': return '✓'
    case 'DRIFT': return '△'
    case 'FAIL': return '✗'
    case 'auth_expired': return '🔒'
  }
}

export interface VerifyCommandOptions {
  readonly site?: string
  readonly all?: boolean
  readonly report?: boolean | string
  readonly autoHeal?: boolean
}

export async function verifyCommand(opts: VerifyCommandOptions): Promise<void> {
  if (opts.all) {
    const results = await verifyAll()

    // Print per-site summary
    for (const r of results) {
      const icon = statusIcon(r.overallStatus)
      const q = r.shouldQuarantine ? ' ⚠️ quarantined' : ''
      process.stdout.write(`${icon} ${r.site}: ${r.overallStatus}${q}\n`)
      for (const o of r.operations) {
        if (o.status === 'PASS') continue
        process.stdout.write(`  ${statusIcon(o.status)} ${o.operationId}: ${o.status} — ${o.detail ?? ''}\n`)
      }
    }

    // Summary line
    const passed = results.filter((r) => r.overallStatus === 'PASS').length
    const drifted = results.filter((r) => r.overallStatus === 'DRIFT').length
    const authExpired = results.filter((r) => r.overallStatus === 'auth_expired').length
    const failed = results.filter((r) => r.overallStatus === 'FAIL').length
    process.stdout.write(`\n${passed} passed, ${drifted} drifted, ${authExpired} auth_expired, ${failed} failed (${results.length} total)\n`)

    // Auto-heal drifted sites
    if (opts.autoHeal) {
      const healable = results.filter(
        (r) => r.overallStatus === 'DRIFT' || r.overallStatus === 'FAIL',
      )
      if (healable.length > 0) {
        process.stdout.write(`\n=== Auto-heal: ${healable.length} site(s) ===\n`)
        const healResults: HealResult[] = []
        for (const r of healable) {
          const hr = await healSite(r.site, r, {
            onLog: (msg) => process.stderr.write(`${msg}\n`),
          })
          healResults.push(hr)
          printHealResult(hr)
        }

        const totalHealed = healResults.reduce((n, r) => n + r.healed.length, 0)
        const totalReported = healResults.reduce((n, r) => n + r.reported.length, 0)
        const totalFailed = healResults.reduce((n, r) => n + r.failed.length, 0)
        process.stdout.write(`\nHeal summary: ${totalHealed} healed, ${totalReported} reported, ${totalFailed} failed\n`)

        if (opts.report) {
          const format = typeof opts.report === 'string' ? opts.report : 'json'
          if (format === 'markdown') {
            process.stdout.write(`\n${generateDriftReportMarkdown(results)}\n`)
            process.stdout.write(`\n## Heal Results\n\n`)
            for (const hr of healResults) {
              process.stdout.write(`### ${hr.site}\n`)
              if (hr.healed.length > 0) process.stdout.write(`- Healed: ${hr.healed.join(', ')}\n`)
              if (hr.reported.length > 0) process.stdout.write(`- Reported: ${hr.reported.join(', ')}\n`)
              if (hr.failed.length > 0) process.stdout.write(`- Failed: ${hr.failed.join(', ')}\n`)
              if (hr.newVersion) process.stdout.write(`- Archived: v${hr.newVersion}\n`)
              process.stdout.write('\n')
            }
          } else {
            process.stdout.write(`\n${JSON.stringify({ verify: generateDriftReport(results), heal: healResults }, null, 2)}\n`)
          }
        }

        if (totalReported > 0 || totalFailed > 0) {
          throw new OpenWebError({
            error: 'execution_failed',
            code: 'EXECUTION_FAILED',
            message: `${totalHealed} healed, ${totalReported} need manual review, ${totalFailed} failed`,
            action: 'Review reported operations manually.',
            retriable: false,
            failureClass: 'fatal',
          })
        }
        return
      }
    }

    // Report output (non-heal path)
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
    const result = await verifySite(opts.site)
    const icon = statusIcon(result.overallStatus)
    const q = result.shouldQuarantine ? ' ⚠️ quarantined' : ''
    process.stdout.write(`${icon} ${result.site}: ${result.overallStatus}${q}\n`)
    for (const o of result.operations) {
      process.stdout.write(`  ${statusIcon(o.status)} ${o.operationId}: ${o.status}${o.detail ? ` — ${o.detail}` : ''}\n`)
    }

    // Auto-heal single site
    if (opts.autoHeal && result.overallStatus !== 'PASS' && result.overallStatus !== 'auth_expired') {
      process.stdout.write(`\n=== Auto-heal: ${result.site} ===\n`)
      const hr = await healSite(result.site, result, {
        onLog: (msg) => process.stderr.write(`${msg}\n`),
      })
      printHealResult(hr)

      if (opts.report) {
        process.stdout.write(`\n${JSON.stringify(hr, null, 2)}\n`)
      }

      if (hr.reported.length > 0 || hr.failed.length > 0) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `${result.site}: ${hr.healed.length} healed, ${hr.reported.length} need review, ${hr.failed.length} failed`,
          action: 'Review reported operations manually.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      return
    }

    if (result.overallStatus !== 'PASS') {
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

  process.stderr.write('Usage: openweb verify <site> or openweb verify --all\n')
  process.exit(1)
}

function printHealResult(hr: HealResult): void {
  if (hr.healed.length > 0) {
    process.stdout.write(`  ✓ healed: ${hr.healed.join(', ')}\n`)
  }
  if (hr.reported.length > 0) {
    process.stdout.write(`  △ reported: ${hr.reported.join(', ')}\n`)
  }
  if (hr.failed.length > 0) {
    process.stdout.write(`  ✗ failed: ${hr.failed.join(', ')}\n`)
  }
  if (hr.newVersion) {
    process.stdout.write(`  → archived v${hr.newVersion}\n`)
  }
}
