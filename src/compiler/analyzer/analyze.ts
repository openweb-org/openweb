/**
 * Phase A6: Report assembly — orchestrates all Phase A modules into
 * a single AnalysisReport.
 */

import { access } from 'node:fs/promises'
import path from 'node:path'

import type { ParameterDescriptor, RecordedRequestSample, SampleResponse } from '../types.js'
import type {
  AnalysisReport,
  CaptureBundle,
  ClusteredEndpoint,
  LabeledSample,
  NavigationGroup,
  NavigationRequest,
  PathNormalization,
  ResponseVariant,
  SampleCategory,
  WsConnectionAnalysis,
  WsHeartbeatCandidate,
  WsOperationSummary,
} from '../types-v2.js'
import type { ExtractionSignal } from './classify.js'
import { loadHar, extractSamples, loadCaptureData } from '../recorder.js'
import { labelSamples } from './labeler.js'
import { clusterSamples } from './cluster.js'
import { normalizePathBatch } from './path-normalize.js'
import { detectGraphqlEndpoint, subClusterGraphql } from './graphql-cluster.js'
import { differentiateParameters } from './differentiate.js'
import { annotateOperation } from './annotate.js'
import { inferSchema } from './schema-v2.js'
import { buildAuthCandidates } from './auth-candidates.js'
import { classify } from './classify.js'
import { loadWsCapture } from '../ws-analyzer/ws-load.js'
import { analyzeWsConnection } from '../ws-analyzer/ws-cluster.js'
import { classifyClusters } from '../ws-analyzer/ws-classify.js'
import { inferWsSchemas } from '../ws-analyzer/ws-schema.js'

// ── Navigation grouping ─────────────────────────────────────────────────────

/** Group samples into page-level navigation by referer + time proximity. */
function buildNavigationGroups(samples: LabeledSample[]): NavigationGroup[] {
  const withTime = samples
    .filter((s) => s.sample.startedDateTime)
    .sort((a, b) => (a.sample.startedDateTime ?? '').localeCompare(b.sample.startedDateTime ?? ''))

  if (withTime.length === 0) return []

  // Group by referer (page), fall back to "unknown" when absent
  const byPage = new Map<string, LabeledSample[]>()
  for (const s of withTime) {
    const page = s.sample.referer ?? 'unknown'
    const list = byPage.get(page)
    if (list) list.push(s)
    else byPage.set(page, [s])
  }

  const groups: NavigationGroup[] = []
  let groupIdx = 0

  for (const [page, pageSamples] of byPage) {
    groupIdx++
    const requests: NavigationRequest[] = pageSamples.map((s) => ({
      sampleId: s.id,
      host: s.sample.host,
      path: s.sample.path,
      method: s.sample.method,
      status: s.sample.status,
      category: s.category,
      responseKind: s.responseKind,
      contentType: s.sample.contentType,
    }))

    groups.push({
      id: `nav-${groupIdx}`,
      page,
      timestamp: pageSamples[0]?.sample.startedDateTime ?? '',
      sampleIds: pageSamples.map((s) => s.id),
      requests,
    })
  }

  return groups
}

// ── Cluster enrichment ───────────────────────────────────────────────────────

/** Map from v1 ClusteredEndpoint to v2 ClusteredEndpoint with full enrichment. */
function enrichClusters(
  v1Clusters: Array<{ method: string; host: string; path: string; samples: RecordedRequestSample[] }>,
  sampleIdMap: Map<RecordedRequestSample, string>,
  pathNormMap: Map<string, { template: string; normalization?: PathNormalization }>,
): ClusteredEndpoint[] {
  const v2Clusters: ClusteredEndpoint[] = []
  let clusterIdx = 0

  for (const v1 of v1Clusters) {
    // Check for GraphQL — may produce sub-clusters
    if (detectGraphqlEndpoint(v1.samples)) {
      const subClusters = subClusterGraphql(v1.samples)
      for (const sub of subClusters) {
        clusterIdx++
        v2Clusters.push(
          buildClusteredEndpoint(
            clusterIdx,
            v1.method,
            v1.host,
            v1.path,
            sub.samples,
            sampleIdMap,
            pathNormMap,
            sub.graphql,
          ),
        )
      }
    } else {
      clusterIdx++
      v2Clusters.push(
        buildClusteredEndpoint(clusterIdx, v1.method, v1.host, v1.path, v1.samples, sampleIdMap, pathNormMap),
      )
    }
  }

  return v2Clusters
}

/** Convert camelCase/PascalCase to snake_case. */
function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

/** Derive operationId + summary from GraphQL cluster info. */
function graphqlOperationAnnotation(
  graphql: ClusteredEndpoint['graphql'] & object,
  method: string,
): { operationId: string; summary: string } {
  let rawName: string | undefined

  // 1. operationName directly available (strip dot+hash suffix if present)
  if (graphql.operationName) {
    const dotIdx = graphql.operationName.indexOf('.')
    rawName = dotIdx > 0 ? graphql.operationName.slice(0, dotIdx) : graphql.operationName
  }
  // 2. queryId — extract the part before the dot (e.g. "voyagerJobsDashJobCards.abc123" → "voyagerJobsDashJobCards")
  if (!rawName && graphql.queryId) {
    const dotIdx = graphql.queryId.indexOf('.')
    rawName = dotIdx > 0 ? graphql.queryId.slice(0, dotIdx) : graphql.queryId
  }

  if (!rawName) {
    // Fall back to generic annotation
    return annotateOperation('', graphql.endpointPath, method)
  }

  // Convert "Dash" in LinkedIn-style names to underscore (e.g. voyagerJobsDashJobCards → voyager_jobs_job_cards)
  const cleaned = rawName.replace(/Dash/g, '_')
  const operationId = toSnakeCase(cleaned)
  const summary = operationId.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

  return { operationId, summary }
}

function buildClusteredEndpoint(
  idx: number,
  method: string,
  host: string,
  normalizedTemplate: string,
  samples: RecordedRequestSample[],
  sampleIdMap: Map<RecordedRequestSample, string>,
  pathNormMap: Map<string, { template: string; normalization?: PathNormalization }>,
  graphql?: ClusteredEndpoint['graphql'],
): ClusteredEndpoint {
  // Collect normalization info from all samples in this cluster
  const normalization = buildClusterNormalization(samples, pathNormMap)

  // Build path parameters from normalized segments
  const pathParams = buildPathParameters(normalizedTemplate, samples, normalization)

  // Differentiate query parameters (v1 cluster format expected)
  const v1Endpoint = { method, host, path: normalizedTemplate, samples }
  const queryParams = differentiateParameters(v1Endpoint)

  // Merge path + query parameters
  const parameters: ParameterDescriptor[] = [...pathParams, ...queryParams]

  // Annotate operation — use GraphQL discriminator when available
  const { operationId, summary } = graphql
    ? graphqlOperationAnnotation(graphql, method)
    : annotateOperation(host, normalizedTemplate, method)

  // Build response variants
  const responseVariants = buildResponseVariants(samples)

  // Infer request body schema from POST/PUT/PATCH bodies
  const requestBodySchema =
    ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())
      ? inferRequestBodySchema(samples)
      : undefined

  // Map samples to their IDs
  const sampleIds = samples
    .map((s) => sampleIdMap.get(s))
    .filter((id): id is string => id !== undefined)

  return {
    id: `cluster-${idx}`,
    method,
    host,
    pathTemplate: normalizedTemplate,
    sampleIds,
    sampleCount: samples.length,
    normalization,
    graphql,
    parameters,
    responseVariants,
    requestBodySchema,
    suggestedOperationId: operationId,
    suggestedSummary: summary,
  }
}

/** Merge normalization info from all samples in a cluster. */
function buildClusterNormalization(
  samples: RecordedRequestSample[],
  pathNormMap: Map<string, { template: string; normalization?: PathNormalization }>,
): PathNormalization | undefined {
  const originalPaths = [...new Set(samples.map((s) => s.path))]
  // Collect all normalized segments from any sample's normalization
  const segmentMap = new Map<number, PathNormalization['normalizedSegments'][number]['kind']>()
  for (const s of samples) {
    const norm = pathNormMap.get(s.path)?.normalization
    if (norm) {
      for (const seg of norm.normalizedSegments) {
        segmentMap.set(seg.index, seg.kind)
      }
    }
  }
  if (segmentMap.size === 0) return undefined
  const normalizedSegments = [...segmentMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, kind]) => ({ index, kind }))
  return { originalPaths, normalizedSegments }
}

/** Build path parameter descriptors from normalized segments. */
function buildPathParameters(
  template: string,
  samples: RecordedRequestSample[],
  normalization?: PathNormalization,
): ParameterDescriptor[] {
  if (!normalization) return []

  const templateSegments = template.split('/')
  const params: ParameterDescriptor[] = []

  for (const seg of normalization.normalizedSegments) {
    const paramPlaceholder = templateSegments[seg.index]
    if (!paramPlaceholder) continue

    // Extract the parameter name from the template (e.g., "{id}" → "id")
    const nameMatch = paramPlaceholder.match(/^\{(.+)\}$/)
    if (!nameMatch) continue
    const name = nameMatch[1]

    // Collect original values from all samples at this segment index
    const values: string[] = []
    for (const s of samples) {
      const rawSegments = s.path.split('/')
      const val = rawSegments[seg.index]
      if (val && !values.includes(val)) values.push(val)
    }

    const numericValues = values.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
    const allNumeric = numericValues.length === values.length && values.length > 0
    const allInteger = allNumeric && numericValues.every((n) => Number.isInteger(n))

    params.push({
      name,
      location: 'path',
      required: true,
      schema: allInteger ? { type: 'integer' } : allNumeric ? { type: 'number' } : { type: 'string' },
      exampleValue: allInteger ? numericValues[0] : allNumeric ? numericValues[0] : values[0],
    })
  }

  return params
}

function buildResponseVariants(samples: RecordedRequestSample[]): ResponseVariant[] {
  // Group by status + responseKind
  const groups = new Map<string, { status: number; kind: SampleResponse['kind']; contentType: string; bodies: unknown[] }>()

  for (const s of samples) {
    const kind = s.response.kind
    const key = `${s.status}:${kind}`
    const group = groups.get(key)
    if (group) {
      group.bodies.push(kind === 'json' ? s.response.body : undefined)
    } else {
      groups.set(key, {
        status: s.status,
        kind,
        contentType: s.contentType,
        bodies: [kind === 'json' ? s.response.body : undefined],
      })
    }
  }

  return [...groups.values()].map((g) => {
    const jsonBodies = g.bodies.filter((b) => b !== undefined)
    return {
      status: g.status,
      kind: g.kind,
      contentType: g.contentType,
      sampleCount: g.bodies.length,
      schema: jsonBodies.length > 0 ? inferSchema(jsonBodies) : undefined,
    }
  })
}

function inferRequestBodySchema(samples: RecordedRequestSample[]) {
  const bodies: unknown[] = []
  for (const s of samples) {
    if (!s.requestBody) continue
    try {
      bodies.push(JSON.parse(s.requestBody))
    } catch {
      // non-JSON body — skip
    }
  }
  return bodies.length > 0 ? inferSchema(bodies) : undefined
}

// ── Summary computation ──────────────────────────────────────────────────────

function computeSummary(
  labeled: LabeledSample[],
  malformedCount: number,
  clusterCount: number,
): AnalysisReport['summary'] {
  const byCategory: Record<SampleCategory, number> = { api: 0, static: 0, tracking: 0, off_domain: 0 }
  const byResponseKind: Record<SampleResponse['kind'], number> = { json: 0, text: 0, empty: 0 }

  for (const s of labeled) {
    byCategory[s.category]++
    byResponseKind[s.responseKind]++
  }

  return {
    totalSamples: labeled.length,
    malformedSamples: malformedCount,
    byCategory,
    byResponseKind,
    clusterCount,
  }
}

// ── WebSocket analysis ──────────────────────────────────────────────────────

/** Check if a file exists (no throw). */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** Compute mean inter-frame interval for heartbeat candidate extraction. */
function meanInterval(frames: Array<{ timestamp: number }>): number {
  if (frames.length < 2) return 0
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  let total = 0
  for (let i = 1; i < sorted.length; i++) {
    total += sorted[i].timestamp - sorted[i - 1].timestamp
  }
  return Math.round(total / (sorted.length - 1))
}

/**
 * Run WS analyzer pipeline on websocket_frames.jsonl if present.
 * Returns connections analysis and global heartbeat candidates.
 */
async function analyzeWsCapture(
  captureDir: string,
  wsFramesPath?: string,
): Promise<AnalysisReport['ws']> {
  const resolvedPath = wsFramesPath ?? path.join(captureDir, 'websocket_frames.jsonl')
  if (!(await fileExists(resolvedPath))) return undefined

  const connections = await loadWsCapture(resolvedPath)
  if (connections.length === 0) return undefined

  const allHeartbeatCandidates: WsHeartbeatCandidate[] = []
  const connectionAnalyses: WsConnectionAnalysis[] = []

  for (const conn of connections) {
    if (conn.frames.length === 0) continue

    // Cluster → classify → schema
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)
    const schemas = inferWsSchemas(classified)

    // Extract heartbeat candidates from classified clusters
    const connHeartbeats: WsHeartbeatCandidate[] = []
    for (const cluster of classified) {
      if (cluster.pattern !== 'heartbeat') continue
      connHeartbeats.push({
        direction: cluster.direction === 'sent' ? 'send' : 'receive',
        intervalMs: meanInterval(cluster.frames),
        payload: cluster.frames[0]?.payload,
      })
    }
    allHeartbeatCandidates.push(...connHeartbeats)

    // Build operation summaries (non-heartbeat only)
    const executableSchemas = schemas.filter((s) => s.pattern !== 'heartbeat')
    const operations: WsOperationSummary[] = executableSchemas.map((s) => ({
      operationId: s.operationId,
      pattern: s.pattern as WsOperationSummary['pattern'],
      direction: s.direction,
      messageTemplate: s.messageTemplate,
    }))

    connectionAnalyses.push({
      id: conn.connectionId,
      url: conn.url,
      sampleCount: conn.frames.length,
      executableOperationCount: executableSchemas.length,
      operations,
      heartbeatCandidates: connHeartbeats,
    })
  }

  if (connectionAnalyses.length === 0) return undefined

  return {
    connections: connectionAnalyses,
    heartbeatCandidates: allHeartbeatCandidates,
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyze a capture bundle, producing a single AnalysisReport.
 *
 * Orchestrates: extract → label → normalize → cluster → enrich → auth → navigation → ws → report.
 */
export async function analyzeCapture(bundle: CaptureBundle): Promise<AnalysisReport> {
  // 1. Load HAR (use explicit harPath, fall back to convention)
  const harPath = bundle.harPath ?? path.join(bundle.captureDir, 'traffic.har')
  const har = await loadHar(bundle.captureDir, harPath)

  // 2. Extract samples
  const { samples, malformedCount } = extractSamples(har)

  // 3. Label samples
  const labeled = labelSamples(samples, bundle.sourceUrl)

  // 4. Filter for api-labeled samples
  const apiSamples = labeled.filter((s) => s.category === 'api').map((s) => s.sample)

  // Build sample → id map for cluster enrichment
  const sampleIdMap = new Map<RecordedRequestSample, string>()
  for (const s of labeled) {
    sampleIdMap.set(s.sample, s.id)
  }

  // 5. Normalize paths BEFORE clustering (structural normalization)
  const allPaths = apiSamples.map((s) => s.path)
  const pathNormMap = normalizePathBatch(allPaths)
  const pathKeyFn = (s: RecordedRequestSample) => pathNormMap.get(s.path)?.template ?? s.path

  // 6. Cluster api samples by normalized path template
  const v1Clusters = clusterSamples(apiSamples, pathKeyFn)

  // 7. Enrich each cluster (graphql, parameters, schema)
  const clusters = enrichClusters(v1Clusters, sampleIdMap, pathNormMap)

  // 8. Load capture data and build auth candidates
  const captureData = await loadCaptureData(bundle.captureDir, har, {
    stateSnapshotDir: bundle.stateSnapshotDir,
    domHtmlPath: bundle.domHtmlPath,
  })
  const authCandidates = buildAuthCandidates(captureData)

  // 9. Get extraction signals from classify
  const classifyResult = classify(captureData)
  const extractionSignals: ExtractionSignal[] = classifyResult.extractions ? [...classifyResult.extractions] : []

  // 10. Build navigation groups
  const navigation = buildNavigationGroups(labeled)

  // 11. Analyze WebSocket capture (if present)
  const ws = await analyzeWsCapture(bundle.captureDir, bundle.wsFramesPath)

  // 12. Assemble report
  return {
    version: 2,
    site: bundle.site,
    sourceUrl: bundle.sourceUrl,
    generatedAt: new Date().toISOString(),
    summary: computeSummary(labeled, malformedCount, clusters.length),
    navigation,
    samples: labeled,
    clusters,
    authCandidates,
    extractionSignals,
    ws,
  }
}
