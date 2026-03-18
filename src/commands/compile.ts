import path from 'node:path'

import Ajv from 'ajv'

import { OpenWebError } from '../lib/errors.js'
import { buildQueryUrl } from '../lib/openapi.js'
import { annotateOperation, annotateParameterDescriptions } from '../compiler/analyzer/annotate.js'
import { clusterSamples } from '../compiler/analyzer/cluster.js'
import { classify } from '../compiler/analyzer/classify.js'
import { differentiateParameters } from '../compiler/analyzer/differentiate.js'
import { filterSamples } from '../compiler/analyzer/filter.js'
import { inferSchema } from '../compiler/analyzer/schema.js'
import { generatePackage } from '../compiler/generator.js'
import { cleanupRecordingDir, loadCaptureData, loadRecordedSamples, runScriptedRecording } from '../compiler/recorder.js'
import { probeOperations, mergeProbeResults } from '../compiler/prober.js'
import { connectWithRetry } from '../capture/connection.js'
import type { AnalyzedOperation, ParameterDescriptor, RecordedRequestSample } from '../compiler/types.js'
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
        in: 'query',
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
  let classifyResult: ReturnType<typeof classify> | undefined // mutable: probe may override
  const site = siteSlugFromUrl(args.url)
  try {
    const recordedSamples = await loadRecordedSamples(recordingDir)
    filteredSamples = filterSamples(recordedSamples, { targetUrl: args.url })

    // Load full capture data for L2 classification
    const captureData = await loadCaptureData(recordingDir)
    if (captureData.harEntries.length > 0 || captureData.stateSnapshots.length > 0 || captureData.domHtml) {
      classifyResult = classify(captureData)
    }
  } finally {
    await cleanupRecordingDir(recordingDir)
  }

  if (filteredSamples.length === 0 && !classifyResult?.extractions) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No filtered samples after analyzer filtering stage.',
      action: 'Record richer interactions or inspect filter rules.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const MUTATION_METHODS = new Set(['post', 'put', 'patch', 'delete'])
  const clusters = clusterSamples(filteredSamples)
  const analyzedOperations: AnalyzedOperation[] = []

  for (const cluster of clusters) {
    const annotation = annotateOperation(cluster.host, cluster.path, cluster.method)
    const differentiatedParams = differentiateParameters(cluster)
    const annotatedParams = annotateParameterDescriptions(differentiatedParams)
    const responseSchema = inferSchema(cluster.samples.map((sample) => sample.responseJson))

    // Gate: skip mutation ops that have recorded request bodies (no body inference yet).
    // Mutations with only query params are safe to emit — params are modeled.
    if (MUTATION_METHODS.has(cluster.method.toLowerCase())) {
      const hasRequestBody = cluster.samples.some((s) => s.requestBody)
      if (hasRequestBody) {
        continue
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

  if (analyzedOperations.length === 0 && !classifyResult?.extractions) {
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
  if (args.probe && classifyResult) {
    const cdpEndpoint = args.cdpEndpoint ?? 'http://localhost:9222'
    let browser
    try {
      browser = await connectWithRetry(cdpEndpoint, 1)
    } catch {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: '--probe requires a managed browser. Could not connect to CDP.',
        action: `Run \`openweb browser start\` first, then retry with --probe.`,
        retriable: true,
        failureClass: 'needs_browser',
      })
    }
    try {
      const probeResults = await probeOperations(analyzedOperations, { browser })
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
  })

  const verifiedCount = analyzedOperations.filter((operation) => operation.verified).length

  if (options.emitSummary) {
    process.stdout.write(
      `Compiled ${analyzedOperations.length} tool(s), verified ${verifiedCount}/${analyzedOperations.length}. Output: ${outputRoot}\n`,
    )
  }

  return {
    site,
    outputRoot,
    operationCount: analyzedOperations.length,
    verifiedCount,
  }
}
