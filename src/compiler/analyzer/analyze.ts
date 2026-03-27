/**
 * Phase A6: Report assembly — orchestrates all Phase A modules into
 * a single AnalysisReport.
 */

import type { RecordedRequestSample, SampleResponse } from '../types.js'
import type {
  AnalysisReport,
  CaptureBundle,
  ClusteredEndpoint,
  LabeledSample,
  NavigationGroup,
  NavigationRequest,
  ResponseVariant,
  SampleCategory,
} from '../types-v2.js'
import type { ExtractionSignal } from './classify.js'
import { loadHar, extractSamples, loadCaptureData } from '../recorder.js'
import { labelSamples } from './labeler.js'
import { clusterSamples } from './cluster.js'
import { normalizePath } from './path-normalize.js'
import { detectGraphqlEndpoint, subClusterGraphql } from './graphql-cluster.js'
import { differentiateParameters } from './differentiate.js'
import { annotateOperation } from './annotate.js'
import { inferSchema } from './schema-v2.js'
import { buildAuthCandidates } from './auth-candidates.js'
import { classify } from './classify.js'

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
            sub.graphql,
          ),
        )
      }
    } else {
      clusterIdx++
      v2Clusters.push(
        buildClusteredEndpoint(clusterIdx, v1.method, v1.host, v1.path, v1.samples, sampleIdMap),
      )
    }
  }

  return v2Clusters
}

function buildClusteredEndpoint(
  idx: number,
  method: string,
  host: string,
  rawPath: string,
  samples: RecordedRequestSample[],
  sampleIdMap: Map<RecordedRequestSample, string>,
  graphql?: ClusteredEndpoint['graphql'],
): ClusteredEndpoint {
  // Path normalization
  const { template, normalization } = normalizePath(rawPath)

  // Differentiate parameters (v1 cluster format expected)
  const v1Endpoint = { method, host, path: rawPath, samples }
  const parameters = differentiateParameters(v1Endpoint)

  // Annotate operation
  const { operationId, summary } = annotateOperation(host, template, method)

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
    pathTemplate: template,
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

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyze a capture bundle, producing a single AnalysisReport.
 *
 * Orchestrates: extract → label → cluster → enrich → auth → navigation → report.
 */
export async function analyzeCapture(bundle: CaptureBundle): Promise<AnalysisReport> {
  // 1. Load HAR
  const har = await loadHar(bundle.captureDir)

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

  // 5. Cluster api samples (v1 cluster.ts)
  const v1Clusters = clusterSamples(apiSamples)

  // 6. Enrich each cluster (path normalization, graphql, parameters, schema)
  const clusters = enrichClusters(v1Clusters, sampleIdMap)

  // 7. Load capture data and build auth candidates (parallel with clustering)
  const captureData = await loadCaptureData(bundle.captureDir, har)
  const authCandidates = buildAuthCandidates(captureData)

  // 8. Get extraction signals from classify
  const classifyResult = classify(captureData)
  const extractionSignals: ExtractionSignal[] = classifyResult.extractions ? [...classifyResult.extractions] : []

  // 9. Build navigation groups
  const navigation = buildNavigationGroups(labeled)

  // 10. Assemble report
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
  }
}
