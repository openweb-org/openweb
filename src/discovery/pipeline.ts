import os from 'node:os'
import path from 'node:path'

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
  /** Output directory for generated fixture (default: src/fixtures/{site}-fixture) */
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
 * End-to-end discovery pipeline:
 * 1. Interactive capture (passive traffic)
 * 2. Active exploration (optional)
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
  // Note: capture session is already stopped at this point.
  // For active exploration, we start a second capture session.
  if (shouldExplore) {
    log('\n=== Phase 2: Active exploration ===')

    // Start a second capture that records during exploration
    const { createCaptureSession } = await import('../capture/session.js')
    const exploreSession = createCaptureSession({
      cdpEndpoint: opts.cdpEndpoint,
      outputDir: capture.recordingDir, // Append to same dir (overwrites)
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

    // Mutations are marked unverified by default (safety constraint)
    const verified = cluster.method === 'GET' ? false : false

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
