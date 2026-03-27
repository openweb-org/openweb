import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Browser } from 'playwright'
import { connectWithRetry } from '../capture/connection.js'
import { analyzeCapture } from '../compiler/analyzer/analyze.js'
import { applyCuration } from '../compiler/curation/apply-curation.js'
import { generateFromPlan } from '../compiler/generator/generate-v2.js'
import { cleanupRecordingDir, runScriptedRecording } from '../compiler/recorder.js'
import type { AnalysisReport, CuratedCompilePlan, CurationDecisionSet, VerifyReport } from '../compiler/types-v2.js'
import { verifyPackage } from '../compiler/verify-v2.js'
import { CDP_ENDPOINT } from '../lib/config.js'
import { OpenWebError } from '../lib/errors.js'

interface CompileArgs {
  readonly url: string
  readonly script?: string
  readonly captureDir?: string
  readonly interactive?: boolean
  readonly probe?: boolean
  readonly cdpEndpoint?: string
  readonly curation?: string
}

interface CompileSiteOptions {
  readonly outputBaseDir?: string
  readonly verifyReplay?: boolean
  readonly emitSummary?: boolean
}

export interface CompileSiteResult {
  readonly site: string
  readonly outputRoot: string
  readonly operationCount: number
  readonly verifiedCount: number
}

function siteSlugFromUrl(urlString: string): string {
  const hostname = new URL(urlString).hostname.replace(/^www\./, '')
  const [label] = hostname.split('.')
  return label || 'site'
}

export async function compileCommand(args: CompileArgs): Promise<void> {
  await compileSite(args, {
    emitSummary: true,
    verifyReplay: true,
  })
}

export async function compileSite(
  args: CompileArgs,
  options: CompileSiteOptions = {},
): Promise<CompileSiteResult> {
  // Clean up stale recording directories from crashed compiles
  await cleanupStaleRecordings()

  if (args.interactive) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Interactive recording is not implemented yet.',
      action: 'Use scripted mode or provide --capture-dir.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const site = siteSlugFromUrl(args.url)
  const userProvidedDir = args.captureDir

  if (!args.script && !userProvidedDir) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Either --script or --capture-dir is required.',
      action: 'Provide a recording script via --script or a pre-recorded capture via --capture-dir.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const recordingDir = userProvidedDir ?? await runScriptedRecording(args.script!)

  // Create report directory early — it's needed for the analysis handoff artifact
  const reportDir = path.join(os.homedir(), '.openweb', 'compile', site)
  await fs.rm(reportDir, { recursive: true, force: true })
  await fs.mkdir(reportDir, { recursive: true })

  // Phase 2: Analyze
  let report: AnalysisReport
  try {
    report = await analyzeCapture({
      site,
      sourceUrl: args.url,
      captureDir: recordingDir,
      harPath: path.join(recordingDir, 'traffic.har'),
    })
  } finally {
    if (!userProvidedDir) {
      await cleanupRecordingDir(recordingDir)
    }
  }

  if (report.clusters.length === 0 && report.extractionSignals.length === 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No API clusters or extraction signals found in capture.',
      action: 'Record richer interactions or inspect filter rules.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // Persist analysis.json — handoff artifact from discover agent to compile agent.
  // Strip JSON response bodies to keep file size manageable (full bodies in analysis-full.json).
  const strippedReport = stripResponseBodies(report)
  await Promise.all([
    fs.writeFile(
      path.join(reportDir, 'analysis.json'),
      `${JSON.stringify(strippedReport, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(reportDir, 'analysis-summary.json'),
      `${JSON.stringify(buildAnalysisSummary(strippedReport), null, 2)}\n`,
    ),
  ])

  // Phase 3: Curate (auto-curation — accept all, top auth candidate, suggested names)
  let curationDecisions: CurationDecisionSet = {}
  if (args.curation) {
    const raw = await fs.readFile(args.curation, 'utf-8')
    curationDecisions = JSON.parse(raw) as CurationDecisionSet
  }
  const plan = applyCuration(report, curationDecisions)

  // Phase 4: Generate
  const pkg = await generateFromPlan(plan, options.outputBaseDir)

  // Phase 5: Verify
  let verifyReport: VerifyReport | undefined
  if (options.verifyReplay !== false) {
    let cookies: string | undefined

    if (args.probe) {
      const cdpEndpoint = args.cdpEndpoint ?? CDP_ENDPOINT
      let browser: Browser | undefined
      try {
        browser = await connectWithRetry(cdpEndpoint, 1)
      } catch {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: '--probe requires a managed browser. Could not connect to CDP.',
          action: "Run `openweb browser start` first, then retry with --probe.",
          retriable: true,
          failureClass: 'needs_browser',
        })
      }
      try {
        const pages = browser.contexts()[0]?.pages() ?? []
        const page = pages[0]
        if (page) {
          const browserCookies = await page.context().cookies()
          cookies = browserCookies.map((c) => `${c.name}=${c.value}`).join('; ')
        }
      } finally {
        await browser.close()
      }
    }

    verifyReport = await verifyPackage({
      operations: plan.operations.map((op) => ({
        operationId: op.operationId,
        method: op.method,
        host: op.host,
        pathTemplate: op.pathTemplate,
        parameters: op.parameters,
        exampleInput: op.exampleInput,
        replaySafety: op.replaySafety,
        requestBody: op.exampleRequestBody,
      })),
      auth: cookies ? { cookies } : undefined,
    })
  }

  const verifiedCount = verifyReport
    ? verifyReport.results.filter((r) => r.overall === 'pass').length
    : 0
  const wsOpCount = plan.ws?.operations.length ?? 0
  const totalOpCount = plan.operations.length + wsOpCount

  // Write remaining report artifacts (analysis.json already written before curation)
  await writeCompileReportV2(reportDir, { report, verifyReport, plan })

  if (options.emitSummary) {
    const parts = [`Compiled ${plan.operations.length} HTTP tool(s), verified ${verifiedCount}/${plan.operations.length}`]
    if (wsOpCount > 0) parts.push(`${wsOpCount} WS operation(s)`)
    parts.push(`Output: ${pkg.outputRoot}`)
    process.stderr.write(`Report: ${reportDir}\n`)
    process.stdout.write(`${parts.join('. ')}.\n`)
  }

  return {
    site,
    outputRoot: pkg.outputRoot,
    operationCount: totalOpCount,
    verifiedCount,
  }
}

// ── V2 compile report ───────────────────────────────────────────

interface CompileReportV2Data {
  readonly report: AnalysisReport
  readonly verifyReport?: VerifyReport
  readonly plan: CuratedCompilePlan
}

function buildSummaryV2(data: CompileReportV2Data): string {
  const { report, verifyReport, plan } = data
  const httpCount = plan.operations.length

  let verifyBreakdown: string
  if (verifyReport) {
    const pass = verifyReport.results.filter((r) => r.overall === 'pass').length
    const skipped = verifyReport.results.filter((r) => r.overall === 'skipped').length
    const fail = verifyReport.results.filter((r) => r.overall === 'fail').length
    const segments = [`${pass} pass`]
    if (skipped > 0) segments.push(`${skipped} skipped (write)`)
    if (fail > 0) segments.push(`${fail} fail (see verify-report.json)`)
    verifyBreakdown = segments.join(', ')
  } else {
    verifyBreakdown = 'verify skipped'
  }

  const parts = [
    `${httpCount} HTTP ops: ${verifyBreakdown}`,
    `${report.summary.byCategory.api}/${report.summary.totalSamples} API samples`,
  ]
  const wsOpCount = plan.ws?.operations.length ?? 0
  if (wsOpCount > 0) parts.push(`${wsOpCount} WS ops`)
  if (plan.context.auth) parts.push('auth=detected')
  return parts.join(', ')
}

async function writeCompileReportV2(reportDir: string, data: CompileReportV2Data): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(reportDir, 'summary.txt'), `${buildSummaryV2(data)}\n`),
    fs.writeFile(path.join(reportDir, 'analysis-full.json'), `${JSON.stringify(data.report, null, 2)}\n`),
    data.verifyReport
      ? fs.writeFile(path.join(reportDir, 'verify-report.json'), `${JSON.stringify(data.verifyReport, null, 2)}\n`)
      : Promise.resolve(),
  ])
}

// ── Analysis stripping ──────────────────────────────────────────

/** Strip JSON response bodies from samples to keep analysis.json agent-readable.
 *  Keeps all metadata, parameters, schemas, auth candidates, extraction signals.
 *  Only removes `sample.response.body` for JSON responses (the main size culprit). */
function stripResponseBodies(report: AnalysisReport): AnalysisReport {
  return {
    ...report,
    samples: report.samples.map((labeled) => {
      const { sample } = labeled
      if (sample.response.kind !== 'json') return labeled
      return {
        ...labeled,
        sample: {
          ...sample,
          response: { kind: 'json' as const, body: '[stripped]' },
        },
      }
    }),
  }
}

/** Build agent-friendly summary — same as analysis.json minus samples and navigation arrays.
 *  Typically <100KB vs multi-MB for the full report. */
function buildAnalysisSummary(report: AnalysisReport): Omit<AnalysisReport, 'samples' | 'navigation'> {
  const { samples: _samples, navigation: _navigation, ...summary } = report
  return summary
}

// ── Stale recording cleanup ─────────────────────────────────────

const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

/** Remove stale openweb-recording-* directories from tmpdir. */
async function cleanupStaleRecordings(): Promise<void> {
  const tmpDir = os.tmpdir()
  let entries: string[]
  try {
    entries = await fs.readdir(tmpDir)
  } catch {
    return
  }
  const now = Date.now()
  const stale = entries.filter((e) => e.startsWith('openweb-recording-'))
  for (const name of stale) {
    const dirPath = path.join(tmpDir, name)
    try {
      const stat = await fs.stat(dirPath)
      if (!stat.isDirectory()) continue
      if (now - stat.mtimeMs > STALE_THRESHOLD_MS) {
        await fs.rm(dirPath, { recursive: true, force: true })
      }
    } catch {
      // Entry disappeared or unreadable — skip
    }
  }
}
