import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'

import { createCaptureSession } from '../capture/session.js'
import { annotateOperation, annotateParameterDescriptions } from '../compiler/analyzer/annotate.js'
import { classify } from '../compiler/analyzer/classify.js'
import { clusterSamples } from '../compiler/analyzer/cluster.js'
import { differentiateParameters } from '../compiler/analyzer/differentiate.js'
import { filterSamples } from '../compiler/analyzer/filter.js'
import { inferSchema } from '../compiler/analyzer/schema.js'
import { generatePackage } from '../compiler/generator.js'
import { cleanupRecordingDir, loadCaptureData, loadRecordedSamples } from '../compiler/recorder.js'
import type { AnalyzedOperation, ParameterDescriptor } from '../compiler/types.js'
import { interactiveCapture, type InteractiveCaptureOptions } from './capture.js'
import { explorePage, exploreForIntents } from './explorer.js'
import { analyzeIntents, type Intent, type IntentAnalysis } from './intent.js'
import { takePageSnapshot } from './page-snapshot.js'

export interface DiscoverOptions {
  /** CDP endpoint */
  readonly cdpEndpoint: string
  /** Target site URL */
  readonly targetUrl: string
  /** Output directory for generated fixture (default: ~/.openweb/discovered/{site}-fixture) */
  readonly outputDir?: string
  /** Enable active exploration (click nav links, search). Default: false */
  readonly explore?: boolean
  /** Enable intent-driven discovery. Default: false */
  readonly intent?: boolean
  /** Capture duration in ms. Default: 8000 */
  readonly captureDuration?: number
  /** Log callback */
  readonly onLog?: (message: string) => void
}

export interface DiscoverResult {
  readonly site: string
  readonly outputRoot: string
  readonly operationCount: number
  readonly explorationStats?: {
    readonly linksClicked: number
    readonly searchesPerformed: number
    readonly discoveredUrls: string[]
  }
  readonly intentCoverage?: {
    readonly matched: Intent[]
    readonly gaps: Intent[]
  }
}

function siteSlugFromUrl(urlString: string): string {
  const hostname = new URL(urlString).hostname.replace(/^www\./, '')
  const parts = hostname.split('.')
  return parts[0] || 'site'
}

function buildExampleInput(parameters: ParameterDescriptor[]): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const p of parameters) {
    input[p.name] = p.exampleValue
  }
  return input
}

/**
 * Merge two HAR files by combining their entries arrays.
 * Reads passiveHar, appends entries from exploreHar, writes back to passiveHar.
 */
async function mergeHarFiles(passiveHarPath: string, exploreHarPath: string): Promise<void> {
  const passiveRaw = await readFile(passiveHarPath, 'utf8')
  const exploreRaw = await readFile(exploreHarPath, 'utf8')
  const passiveHar = JSON.parse(passiveRaw) as { entries?: unknown[] }
  const exploreHar = JSON.parse(exploreRaw) as { entries?: unknown[] }

  const merged = {
    ...passiveHar,
    entries: [...(passiveHar.entries ?? []), ...(exploreHar.entries ?? [])],
  }
  await writeFile(passiveHarPath, JSON.stringify(merged, null, 2))
}

/**
 * End-to-end discovery pipeline:
 * 1. Interactive capture (passive traffic)
 * 2. Active exploration (optional — blind or intent-driven)
 * 3. Filter → Cluster → Annotate → Classify → Generate
 */
export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const log = opts.onLog ?? (() => {})
  const site = siteSlugFromUrl(opts.targetUrl)
  const shouldExplore = opts.explore ?? false
  const shouldIntent = opts.intent ?? false

  // Step 1: Interactive capture
  log('=== Phase 1: Passive capture ===')
  const captureOpts: InteractiveCaptureOptions = {
    cdpEndpoint: opts.cdpEndpoint,
    targetUrl: opts.targetUrl,
    captureDuration: opts.captureDuration,
    onLog: log,
  }

  const capture = await interactiveCapture(captureOpts)
  let explorationStats: DiscoverResult['explorationStats']
  let intentAnalysis: IntentAnalysis | undefined

  // Step 2a: Intent-driven exploration (opt-in via --intent)
  if (shouldIntent) {
    log('\n=== Phase 2a: Intent analysis ===')

    // Take page snapshot (DOM already rendered after passive capture)
    const snapshot = await takePageSnapshot(capture.page)
    log(`snapshot: ${String(snapshot.navLinks.length)} nav, ${String(snapshot.buttons.length)} buttons, ${String(snapshot.searchInputs.length)} search, ${String(snapshot.forms.length)} forms`)

    // Load passive samples for initial intent analysis
    const passiveSamples = await loadRecordedSamples(capture.recordingDir)
    const filtered = filterSamples(passiveSamples, { targetUrl: opts.targetUrl })
    const capturedPaths = filtered.map((s) => ({ path: s.path, method: s.method }))

    intentAnalysis = analyzeIntents(snapshot, capturedPaths)
    log(`intents matched: ${intentAnalysis.matched.map((m) => m.intent).join(', ') || 'none'}`)
    log(`intent gaps: ${intentAnalysis.gaps.map((g) => g.intent).join(', ') || 'none'}`)

    // Targeted exploration for gaps
    if (intentAnalysis.gaps.length > 0) {
      log('\n=== Phase 2b: Targeted exploration ===')

      const exploreDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-intent-'))
      const exploreSession = createCaptureSession({
        cdpEndpoint: opts.cdpEndpoint,
        outputDir: exploreDir,
        targetPage: capture.page,
        isolateToTargetPage: true,
        onLog: log,
      })

      try {
        await exploreSession.ready
        const result = await exploreForIntents(capture.page, intentAnalysis.gaps, snapshot, log)
        explorationStats = result
        log(`intent exploration: ${String(result.linksClicked)} clicks, ${String(result.searchesPerformed)} searches`)
      } finally {
        exploreSession.stop()
        await exploreSession.done
      }

      // Merge intent exploration HAR into passive HAR
      try {
        await mergeHarFiles(
          path.join(capture.recordingDir, 'traffic.har'),
          path.join(exploreDir, 'traffic.har'),
        )
      } catch {
        // non-fatal
      }

      await cleanupRecordingDir(exploreDir)
    }
  }

  // Step 2c: Blind exploration (legacy --explore, independent of --intent)
  if (shouldExplore) {
    log('\n=== Phase 2c: Active exploration ===')

    const exploreDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-explore-'))
    const exploreSession = createCaptureSession({
      cdpEndpoint: opts.cdpEndpoint,
      outputDir: exploreDir,
      targetPage: capture.page,
      isolateToTargetPage: true,
      onLog: log,
    })

    try {
      await exploreSession.ready
      const result = await explorePage(capture.page, log)
      // Merge stats if intent already ran
      if (explorationStats) {
        explorationStats = {
          linksClicked: explorationStats.linksClicked + result.linksClicked,
          searchesPerformed: explorationStats.searchesPerformed + result.searchesPerformed,
          discoveredUrls: [...explorationStats.discoveredUrls, ...result.discoveredUrls],
        }
      } else {
        explorationStats = result
      }
      log(`explored ${String(result.linksClicked)} links, ${String(result.searchesPerformed)} searches`)
    } finally {
      exploreSession.stop()
      await exploreSession.done
    }

    // Merge exploration HAR into passive HAR
    try {
      await mergeHarFiles(
        path.join(capture.recordingDir, 'traffic.har'),
        path.join(exploreDir, 'traffic.har'),
      )
    } catch {
      // Merge failure is non-fatal — passive data still available
    }

    await cleanupRecordingDir(exploreDir)
  }

  // Disconnect browser (Fix #4: prevent leaked Playwright connections)
  try {
    capture.browser.disconnect()
  } catch {
    // already disconnected
  }

  // Step 3: Compile pipeline
  log('\n=== Phase 3: Compile ===')

  let filteredSamples
  let classifyResult: ReturnType<typeof classify> | undefined

  try {
    const recordedSamples = await loadRecordedSamples(capture.recordingDir)
    log(`loaded ${String(recordedSamples.length)} raw samples`)

    filteredSamples = filterSamples(recordedSamples, { targetUrl: opts.targetUrl })
    log(`filtered to ${String(filteredSamples.length)} relevant samples`)

    // L2 classification
    const captureData = await loadCaptureData(capture.recordingDir)
    if (captureData.harEntries.length > 0 || captureData.stateSnapshots.length > 0 || captureData.domHtml) {
      classifyResult = classify(captureData)
      if (classifyResult.auth) log(`detected auth: ${classifyResult.auth.type}`)
      if (classifyResult.csrf) log(`detected CSRF: ${classifyResult.csrf.type}`)
      if (classifyResult.signing) log(`detected signing: ${classifyResult.signing.type}`)
      if (classifyResult.extractions?.length) {
        log(`detected ${String(classifyResult.extractions.length)} extraction(s)`)
      }
    }
  } finally {
    await cleanupRecordingDir(capture.recordingDir)
  }

  if (filteredSamples.length === 0 && !classifyResult?.extractions) {
    log('WARNING: No API endpoints discovered. The site may require more interaction.')
    return { site, outputRoot: '', operationCount: 0, explorationStats, intentCoverage: intentAnalysis ? { matched: intentAnalysis.matched.map((m) => m.intent), gaps: intentAnalysis.gaps.map((g) => g.intent) } : undefined }
  }

  const clusters = clusterSamples(filteredSamples)
  const analyzedOperations: AnalyzedOperation[] = []

  for (const cluster of clusters) {
    const annotation = annotateOperation(cluster.host, cluster.path, cluster.method)
    const params = differentiateParameters(cluster)
    const annotatedParams = annotateParameterDescriptions(params)
    const responseSchema = inferSchema(cluster.samples.map((s) => s.responseJson))

    // Discovery pipeline marks all operations unverified — verification
    // requires auth context which discover doesn't have yet
    const verified = false

    analyzedOperations.push({
      method: cluster.method.toLowerCase(),
      host: cluster.host,
      path: cluster.path,
      operationId: annotation.operationId,
      summary: annotation.summary,
      parameters: annotatedParams,
      responseSchema,
      exampleInput: buildExampleInput(annotatedParams),
      verified,
    })
  }

  log(`analyzed ${String(analyzedOperations.length)} operations`)

  // Intent coverage report (post-compile, final analysis)
  let intentCoverage: DiscoverResult['intentCoverage']
  if (shouldIntent && intentAnalysis) {
    // Re-analyze with full operation set
    const finalPaths = analyzedOperations.map((op) => ({ path: op.path, method: op.method }))
    const finalAnalysis = analyzeIntents(
      { navLinks: [], headings: [], buttons: [], forms: [], searchInputs: [] },
      finalPaths,
    )
    const allMatched = new Set([
      ...intentAnalysis.matched.map((m) => m.intent),
      ...finalAnalysis.matched.map((m) => m.intent),
    ])
    const remainingGaps = intentAnalysis.gaps
      .map((g) => g.intent)
      .filter((intent) => !allMatched.has(intent))

    intentCoverage = {
      matched: [...allMatched],
      gaps: remainingGaps,
    }
    log(`\nintent coverage: ${String(allMatched.size)} matched, ${String(remainingGaps.length)} gaps remaining`)
  }

  // Generate fixture package — use ~/.openweb/discovered/ to avoid overwriting existing fixtures
  const outputBaseDir = opts.outputDir
    ? path.dirname(opts.outputDir)
    : path.join(os.homedir(), '.openweb', 'discovered')
  const fixtureName = opts.outputDir ? path.basename(opts.outputDir) : `${site}-fixture`
  const outputRoot = await generatePackage({
    site: fixtureName,
    sourceUrl: opts.targetUrl,
    operations: analyzedOperations,
    outputBaseDir,
    classify: classifyResult,
  })

  log(`generated fixture at ${outputRoot}`)

  return {
    site: fixtureName,
    outputRoot,
    operationCount: analyzedOperations.length,
    explorationStats,
    intentCoverage,
  }
}
