import path from 'node:path'

import Ajv from 'ajv'

import { OpenWebError } from '../lib/errors.js'
import { buildQueryUrl } from '../lib/openapi.js'
import { annotateOperation, annotateParameterDescriptions } from '../compiler/analyzer/annotate.js'
import { clusterSamples } from '../compiler/analyzer/cluster.js'
import { differentiateParameters } from '../compiler/analyzer/differentiate.js'
import { filterSamples } from '../compiler/analyzer/filter.js'
import { inferSchema } from '../compiler/analyzer/schema.js'
import { generatePackage } from '../compiler/generator.js'
import { cleanupRecordingDir, loadRecordedSamples, runScriptedRecording } from '../compiler/recorder.js'
import type { AnalyzedOperation, ParameterDescriptor, RecordedRequestSample } from '../compiler/types.js'
import { fetchWithValidatedRedirects } from '../runtime/executor.js'

interface CompileArgs {
  readonly url: string
  readonly script?: string
  readonly interactive?: boolean
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

    const response = await fetchWithValidatedRedirects(url, operation.method.toUpperCase(), {
      fetchImpl: fetch,
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
  const site = siteSlugFromUrl(args.url)
  try {
    const recordedSamples = await loadRecordedSamples(recordingDir)
    filteredSamples = filterSamples(recordedSamples)
  } finally {
    await cleanupRecordingDir(recordingDir)
  }

  if (filteredSamples.length === 0) {
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
    if (cluster.method !== 'GET') {
      continue
    }

    const annotation = annotateOperation(cluster.host, cluster.path)
    const differentiatedParams = differentiateParameters(cluster)
    const annotatedParams = annotateParameterDescriptions(differentiatedParams)
    const responseSchema = inferSchema(cluster.samples.map((sample) => sample.responseJson))

    const operationBase = {
      method: 'get' as const,
      host: cluster.host,
      path: cluster.path,
      operationId: annotation.operationId,
      summary: annotation.summary,
      parameters: annotatedParams,
      responseSchema,
      exampleInput: buildExampleInput(annotatedParams),
    }

    const verified = options.verifyReplay === false ? false : await verifyOperation(operationBase)

    analyzedOperations.push({
      ...operationBase,
      verified,
    })
  }

  if (analyzedOperations.length === 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No operations were produced from analyzed clusters.',
      action: 'Check recorded traffic and analyzer rules.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const outputRoot = await generatePackage({
    site,
    sourceUrl: args.url,
    operations: analyzedOperations,
    outputBaseDir: options.outputBaseDir,
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
