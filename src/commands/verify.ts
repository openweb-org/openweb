import { verifySite, verifyAll, generateDriftReport, generateDriftReportMarkdown, type OperationStatus } from '../lifecycle/verify.js'

function statusIcon(status: OperationStatus): string {
  switch (status) {
    case 'PASS': return '✓'
    case 'DRIFT': return '△'
    case 'FAIL': return '✗'
  }
}

export interface VerifyCommandOptions {
  readonly site?: string
  readonly all?: boolean
  readonly report?: boolean | string
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
    const failed = results.filter((r) => r.overallStatus === 'FAIL').length
    process.stdout.write(`\n${passed} passed, ${drifted} drifted, ${failed} failed (${results.length} total)\n`)

    // Report output
    if (opts.report) {
      const format = typeof opts.report === 'string' ? opts.report : 'json'
      if (format === 'markdown') {
        process.stdout.write(`\n${generateDriftReportMarkdown(results)}\n`)
      } else {
        process.stdout.write(`\n${JSON.stringify(generateDriftReport(results), null, 2)}\n`)
      }
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
    return
  }

  process.stderr.write('Usage: openweb verify <site> or openweb verify --all\n')
  process.exit(1)
}
