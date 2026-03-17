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
import { explorePage } from './explorer.js'

export interface DiscoverOptions {
  /** CDP endpoint */
  readonly cdpEndpoint: string
  /** Target site URL */
  readonly targetUrl: string
  /** Output directory for generated fixture (default: ~/.openweb/discovered/{site}-fixture) */
  readonly outputDir?: string
  /** Enable active exploration (click nav links, search). Default: true */
  readonly explore?: boolean
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
 * 2. Active exploration (optional, separate capture dir → merge)
 * 3. Filter → Cluster → Annotate → Classify → Generate
 */
export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const log = opts.onLog ?? (() => {})
  const site = siteSlugFromUrl(opts.targetUrl)
  const shouldExplore = opts.explore ?? true

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

  // Step 2: Active exploration (optional)
  // Uses a SEPARATE capture dir to avoid overwriting passive data, then merges.
  if (shouldExplore) {
    log('\n=== Phase 2: Active exploration ===')

    const exploreDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-explore-'))
    const exploreSession = createCaptureSession({
      cdpEndpoint: opts.cdpEndpoint,
      outputDir: exploreDir,
      onLog: log,
    })

    try {
      const result = await explorePage(capture.page, log)
      explorationStats = result
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
    return { site, outputRoot: '', operationCount: 0, explorationStats }
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
  }
}
