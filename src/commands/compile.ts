import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Ajv from 'ajv'

import { OpenWebError } from '../lib/errors.js'
import { CDP_ENDPOINT } from '../lib/config.js'
import { buildQueryUrl } from '../lib/openapi.js'
import { annotateOperation, annotateParameterDescriptions } from '../compiler/analyzer/annotate.js'
import { clusterSamples } from '../compiler/analyzer/cluster.js'
import { classify } from '../compiler/analyzer/classify.js'
import type { ClassifyResult } from '../compiler/analyzer/classify.js'
import { differentiateParameters } from '../compiler/analyzer/differentiate.js'
import { filterSamples } from '../compiler/analyzer/filter.js'
import type { FilteredSample } from '../compiler/analyzer/filter.js'
import { inferSchema } from '../compiler/analyzer/schema.js'
import { generatePackage } from '../compiler/generator/index.js'
import type { GeneratePackageInput } from '../compiler/generator/index.js'
import { cleanupRecordingDir, loadCaptureData, loadRecordedSamples, runScriptedRecording } from '../compiler/recorder.js'
import { probeOperations, mergeProbeResults } from '../compiler/prober.js'
import type { ProbeResult } from '../compiler/prober.js'
import { connectWithRetry } from '../capture/connection.js'
import type { Browser } from 'playwright'
import { loadWsCapture } from '../compiler/ws-analyzer/ws-load.js'
import type { WsConnection } from '../compiler/ws-analyzer/ws-load.js'
import { analyzeWsConnection } from '../compiler/ws-analyzer/ws-cluster.js'
import { classifyClusters } from '../compiler/ws-analyzer/ws-classify.js'
import { inferWsSchemas } from '../compiler/ws-analyzer/ws-schema.js'
import type { AnalyzedOperation, ClusteredEndpoint, ParameterDescriptor, RecordedRequestSample } from '../compiler/types.js'
import { fetchWithRedirects } from '../runtime/redirect.js'
import { validateSSRF } from '../lib/ssrf.js'

interface CompileArgs {
  readonly url: string
  readonly script?: string
  readonly interactive?: boolean
  readonly probe?: boolean
  readonly cdpEndpoint?: string
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

function buildExampleInput(parameters: ParameterDescriptor[]): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const parameter of parameters) {
    input[parameter.name] = parameter.exampleValue
  }
  return input
}

async function verifyOperation(operation: Omit<AnalyzedOperation, 'verified'>): Promise<boolean> {
  try {
    const url = buildQueryUrl(
      `https://${operation.host}`,
      operation.path,
      operation.parameters.map((parameter) => ({
        name: parameter.name,
        in: parameter.location,
        required: parameter.required,
        schema: parameter.schema,
      })),
      operation.exampleInput,
    )

    const response = await fetchWithRedirects(url, operation.method.toUpperCase(), { Accept: 'application/json' }, undefined, {
      fetchImpl: fetch,
      ssrfValidator: validateSSRF,
    })

    if (!response.ok) {
      return false
    }

    const body = await response.json()
    const validator = new Ajv({ strict: false }).compile(operation.responseSchema)
    return Boolean(validator(body))
  } catch {
    // intentional: verification probe failed (network, parse) — treat as unverified
    return false
  }
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
  if (args.interactive) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Interactive recording is not implemented yet in MVP scaffold.',
      action: 'Use scripted mode: `openweb compile <url> --script scripts/record_open_meteo.ts`.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const scriptPath = args.script ?? path.join('scripts', 'record_open_meteo.ts')

  const recordingDir = await runScriptedRecording(scriptPath)
  let filteredSamples: RecordedRequestSample[] = []
  let rejectedSamples: FilteredSample[] = []
  let totalRecordedCount = 0
  let classifyResult: ReturnType<typeof classify> | undefined // mutable: probe may override
  let wsInput: GeneratePackageInput['ws'] | undefined
  const site = siteSlugFromUrl(args.url)
  try {
    const recordedSamples = await loadRecordedSamples(recordingDir)
    totalRecordedCount = recordedSamples.length
    const filterResult = filterSamples(recordedSamples, { targetUrl: args.url })
    filteredSamples = filterResult.kept
    rejectedSamples = filterResult.rejected

    // Load full capture data for L2 classification
    const captureData = await loadCaptureData(recordingDir)
    if (captureData.harEntries.length > 0 || captureData.stateSnapshots.length > 0 || captureData.domHtml) {
      classifyResult = classify(captureData)
    }

    // Load WS capture data if present
    const wsFramesPath = path.join(recordingDir, 'websocket_frames.jsonl')
    if (existsSync(wsFramesPath)) {
      wsInput = compileWsFrames(await loadWsCapture(wsFramesPath))
    }
  } finally {
    await cleanupRecordingDir(recordingDir)
  }

  const hasWsOps = wsInput && wsInput.operations.length > 0
  if (filteredSamples.length === 0 && !classifyResult?.extractions && !hasWsOps) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No filtered samples after analyzer filtering stage.',
      action: 'Record richer interactions or inspect filter rules.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const clusters = clusterSamples(filteredSamples)
  const analyzedOperations: AnalyzedOperation[] = []

  for (const cluster of clusters) {
    const annotation = annotateOperation(cluster.host, cluster.path, cluster.method)
    const differentiatedParams = differentiateParameters(cluster)
    const annotatedParams = annotateParameterDescriptions(differentiatedParams)
    const responseSchema = inferSchema(cluster.samples.map((sample) => sample.responseJson))

    // Infer request body schema from recorded samples (for write operations)
    let requestBodySchema: ReturnType<typeof inferSchema> | undefined
    let exampleRequestBody: unknown | undefined
    if (cluster.method !== 'GET' && cluster.method !== 'HEAD') {
      const parsedBodies: unknown[] = []
      for (const sample of cluster.samples) {
        if (sample.requestBody) {
          try {
            parsedBodies.push(JSON.parse(sample.requestBody))
          } catch {
            // non-JSON body — skip schema inference
          }
        }
      }
      if (parsedBodies.length > 0) {
        requestBodySchema = inferSchema(parsedBodies)
        exampleRequestBody = parsedBodies[0]
      }
    }

    const operationBase = {
      method: cluster.method.toLowerCase(),
      host: cluster.host,
      path: cluster.path,
      operationId: annotation.operationId,
      summary: annotation.summary,
      parameters: annotatedParams,
      responseSchema,
      requestBodySchema,
      exampleRequestBody,
      exampleInput: buildExampleInput(annotatedParams),
    }

    // Only verify GET operations — mutations are not safe to replay
    const verified = options.verifyReplay === false || cluster.method !== 'GET'
      ? false
      : await verifyOperation(operationBase)

    analyzedOperations.push({
      ...operationBase,
      verified,
    })
  }

  if (analyzedOperations.length === 0 && !classifyResult?.extractions && !hasWsOps) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No operations were produced from analyzed clusters.',
      action: 'Check recorded traffic and analyzer rules.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // Probe: validate classify heuristics with real requests (opt-in)
  let probeResults: ProbeResult[] | undefined
  if (args.probe && classifyResult) {
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
      probeResults = await probeOperations(analyzedOperations, { browser })
      classifyResult = mergeProbeResults(classifyResult, probeResults)
    } finally {
      await browser.close()
    }
  }

  const outputRoot = await generatePackage({
    site,
    sourceUrl: args.url,
    operations: analyzedOperations,
    outputBaseDir: options.outputBaseDir,
    classify: classifyResult,
    ws: wsInput,
  })

  const verifiedCount = analyzedOperations.filter((operation) => operation.verified).length
  const wsOpCount = wsInput?.operations.length ?? 0
  const totalOpCount = analyzedOperations.length + wsOpCount

  // Write compile report
  const reportDir = path.join(os.homedir(), '.openweb', 'compile', site)
  await writeCompileReport(reportDir, {
    totalRecorded: totalRecordedCount,
    kept: filteredSamples,
    rejected: rejectedSamples,
    clusters,
    classifyResult,
    probeResults,
    analyzedOperations,
    verifiedCount,
    wsOpCount,
  })

  if (options.emitSummary) {
    const parts = [`Compiled ${analyzedOperations.length} HTTP tool(s), verified ${verifiedCount}/${analyzedOperations.length}`]
    if (wsOpCount > 0) {
      parts.push(`${wsOpCount} WS operation(s)`)
    }
    parts.push(`Output: ${outputRoot}`)
    process.stderr.write(`Report: ${reportDir}\n`)
    process.stdout.write(`${parts.join('. ')}.\n`)
  }

  return {
    site,
    outputRoot,
    operationCount: totalOpCount,
    verifiedCount,
  }
}

// ── Compile report ───────────────────────────────────────────

interface CompileReportData {
  readonly totalRecorded: number
  readonly kept: RecordedRequestSample[]
  readonly rejected: FilteredSample[]
  readonly clusters: ClusteredEndpoint[]
  readonly classifyResult?: ClassifyResult
  readonly probeResults?: ProbeResult[]
  readonly analyzedOperations: AnalyzedOperation[]
  readonly verifiedCount: number
  readonly wsOpCount: number
}

function buildFilteredJson(data: CompileReportData) {
  const byReason: Record<string, number> = {}
  for (const r of data.rejected) {
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
  }

  const requests = [
    ...data.kept.map((s) => ({
      host: s.host,
      path: s.path,
      method: s.method,
      status: s.status,
      content_type: s.contentType,
      result: 'kept' as const,
    })),
    ...data.rejected.map((r) => ({
      host: r.sample.host,
      path: r.sample.path,
      method: r.sample.method,
      status: r.sample.status,
      content_type: r.sample.contentType,
      result: 'rejected' as const,
      reason: r.reason,
    })),
  ]

  return {
    compiled_at: new Date().toISOString(),
    total: data.totalRecorded,
    kept: data.kept.length,
    rejected: data.rejected.length,
    by_reason: byReason,
    requests,
  }
}

function buildClustersJson(clusters: ClusteredEndpoint[]) {
  const isGraphqlSingleEndpoint = clusters.length > 1
    && clusters.every((c) => c.path === clusters[0].path && c.method.toLowerCase() === 'post')

  return {
    compiled_at: new Date().toISOString(),
    cluster_count: clusters.length,
    graphql_single_endpoint: isGraphqlSingleEndpoint,
    clusters: clusters.map((c) => ({
      method: c.method,
      host: c.host,
      path: c.path,
      sample_count: c.samples.length,
    })),
  }
}

function confidenceLevel(result: ClassifyResult): 'high' | 'medium' | 'low' {
  if (result.auth?.type === 'localStorage_jwt' || result.auth?.type === 'exchange_chain') return 'high'
  if (result.auth?.type === 'cookie_session' && result.csrf) return 'high'
  if (result.auth?.type === 'cookie_session') return 'medium'
  return 'low'
}

function buildClassifyJson(result: ClassifyResult) {
  return {
    compiled_at: new Date().toISOString(),
    confidence: confidenceLevel(result),
    transport: result.transport,
    auth: result.auth ?? null,
    csrf: result.csrf ?? null,
    signing: result.signing ?? null,
    extractions: result.extractions ?? null,
  }
}

function buildProbeJson(probeResults: ProbeResult[]) {
  return {
    compiled_at: new Date().toISOString(),
    probed: probeResults.length,
    results: probeResults,
  }
}

function buildSummaryTxt(data: CompileReportData): string {
  const parts = [
    `${data.analyzedOperations.length} HTTP ops`,
    `${data.verifiedCount} verified`,
    `${data.kept.length}/${data.totalRecorded} requests kept`,
  ]
  if (data.wsOpCount > 0) parts.push(`${data.wsOpCount} WS ops`)
  if (data.classifyResult?.auth) parts.push(`auth=${data.classifyResult.auth.type}`)
  return parts.join(', ')
}

async function writeCompileReport(reportDir: string, data: CompileReportData): Promise<void> {
  await fs.rm(reportDir, { recursive: true, force: true })
  await fs.mkdir(reportDir, { recursive: true })

  await Promise.all([
    fs.writeFile(path.join(reportDir, 'summary.txt'), `${buildSummaryTxt(data)}\n`),
    fs.writeFile(path.join(reportDir, 'filtered.json'), `${JSON.stringify(buildFilteredJson(data), null, 2)}\n`),
    fs.writeFile(path.join(reportDir, 'clusters.json'), `${JSON.stringify(buildClustersJson(data.clusters), null, 2)}\n`),
    data.classifyResult
      ? fs.writeFile(path.join(reportDir, 'classify.json'), `${JSON.stringify(buildClassifyJson(data.classifyResult), null, 2)}\n`)
      : Promise.resolve(),
    data.probeResults
      ? fs.writeFile(path.join(reportDir, 'probe.json'), `${JSON.stringify(buildProbeJson(data.probeResults), null, 2)}\n`)
      : Promise.resolve(),
  ])
}

// ── WS compiler pipeline ─────────────────────────────────────

/** Minimum JSON-parseable text frames to compile a WS connection. */
const MIN_WS_FRAMES = 10

/** Executable WS patterns (heartbeat is control, not an operation). */
const EXECUTABLE_PATTERNS = new Set(['subscribe', 'publish', 'request_reply', 'stream'])

/**
 * Run the WS compiler pipeline with confidence gates.
 *
 * Gates (all must pass per connection):
 * 1. ≥ MIN_WS_FRAMES JSON-parseable text frames
 * 2. Stable discriminator (score > 0 for at least one direction)
 * 3. At least one executable operation pattern detected
 *
 * Returns undefined if no connections pass all gates.
 */
function compileWsFrames(
  connections: WsConnection[],
): GeneratePackageInput['ws'] | undefined {
  if (connections.length === 0) return undefined

  // Pick the richest connection that passes confidence gates
  for (const conn of connections) {
    // Gate 1: enough JSON frames
    if (conn.frames.length < MIN_WS_FRAMES) continue

    // Stage 2: cluster + discriminator detection
    const analysis = analyzeWsConnection(conn)

    // Gate 2: stable discriminator in at least one direction
    if (!analysis.discriminator.sent && !analysis.discriminator.received) continue

    // Stage 3: classify patterns
    const classified = classifyClusters(analysis.clusters)

    // Gate 3: at least one executable pattern
    const executableClusters = classified.filter((c) => EXECUTABLE_PATTERNS.has(c.pattern))
    if (executableClusters.length === 0) continue

    // Stage 4: schema inference (only on executable clusters)
    const wsOps = inferWsSchemas(executableClusters)

    return {
      serverUrl: conn.url,
      serverExtensions: {
        transport: 'node',
        discriminator: analysis.discriminator,
      },
      operations: wsOps,
    }
  }

  return undefined
}
