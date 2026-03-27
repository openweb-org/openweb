/**
 * Curation: transforms AnalysisReport + CurationDecisionSet into CuratedCompilePlan.
 *
 * Pure function — same inputs always produce the same output.
 */

import type { PermissionCategory } from '../../types/extensions.js'
import type {
  AnalysisReport,
  AuthCandidate,
  ClusteredEndpoint,
  CuratedCompilePlan,
  CuratedOperation,
  CuratedSiteContext,
  CuratedWsOperation,
  CuratedWsPlan,
  CurationDecisionSet,
} from '../types-v2.js'
import { scrubExamples, scrubRequestBody } from './scrub.js'

function selectAuthCandidate(
  candidates: readonly AuthCandidate[],
  selectedId?: string,
): AuthCandidate | undefined {
  if (candidates.length === 0) return undefined
  if (selectedId) return candidates.find((c) => c.id === selectedId)
  // Highest rank = lowest rank number (rank 1 is best)
  return [...candidates].sort((a, b) => a.rank - b.rank)[0]
}

function buildSiteContext(
  candidate: AuthCandidate | undefined,
  selectedId?: string,
): CuratedSiteContext {
  if (!candidate) return { transport: 'node' }
  return {
    transport: candidate.transport,
    auth: candidate.auth,
    csrf: candidate.csrf,
    signing: candidate.signing,
    selectedAuthCandidateId: selectedId ?? candidate.id,
  }
}

function defaultPermission(cluster: ClusteredEndpoint): PermissionCategory {
  // G-4 fix: GraphQL queries are reads regardless of HTTP method
  if (cluster.graphql?.operationType === 'query') return 'read'

  const method = cluster.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') return 'read'
  if (method === 'DELETE') return 'delete'
  return 'write'
}

function defaultReplaySafety(cluster: ClusteredEndpoint): 'safe_read' | 'unsafe_mutation' {
  if (cluster.graphql?.operationType === 'query') return 'safe_read'
  const method = cluster.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') return 'safe_read'
  return 'unsafe_mutation'
}

function buildExampleInput(cluster: ClusteredEndpoint): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const param of cluster.parameters) {
    if (param.exampleValue !== undefined) {
      input[param.name] = param.exampleValue
    }
  }
  return input
}

function curateOperation(
  cluster: ClusteredEndpoint,
  overrides: CurationDecisionSet['operationOverrides'] extends ReadonlyArray<infer T>
    ? T | undefined
    : never,
): CuratedOperation {
  const exampleInput = scrubExamples(overrides?.exampleInput ?? buildExampleInput(cluster))
  const exampleRequestBody = overrides?.exampleRequestBody
    ? scrubRequestBody(overrides.exampleRequestBody)
    : undefined

  return {
    id: cluster.id,
    sourceClusterIds: [cluster.id],
    method: cluster.method,
    host: cluster.host,
    pathTemplate: cluster.pathTemplate,
    operationId: overrides?.operationId ?? cluster.suggestedOperationId,
    summary: overrides?.summary ?? cluster.suggestedSummary,
    permission: overrides?.permission ?? defaultPermission(cluster),
    replaySafety: overrides?.replaySafety ?? defaultReplaySafety(cluster),
    parameters: cluster.parameters,
    responseVariants: cluster.responseVariants,
    requestBodySchema: cluster.requestBodySchema,
    exampleInput,
    exampleRequestBody,
  }
}

function buildWsPlan(ws: NonNullable<AnalysisReport['ws']>): CuratedWsPlan {
  const firstConnection = ws.connections[0]
  if (!firstConnection) {
    return { serverUrl: '', operations: [] }
  }

  const operations: CuratedWsOperation[] = ws.connections.map((conn) => ({
    id: conn.id,
    name: conn.id,
    pattern: 'subscribe' as const,
  }))

  return {
    serverUrl: firstConnection.url,
    heartbeat: ws.heartbeatCandidates[0],
    operations,
  }
}

/** Transform an AnalysisReport + curation decisions into a CuratedCompilePlan. */
export function applyCuration(
  report: AnalysisReport,
  decisions: CurationDecisionSet,
): CuratedCompilePlan {
  const excluded = new Set(decisions.excludedClusterIds ?? [])
  const overridesMap = new Map(
    (decisions.operationOverrides ?? []).map((o) => [o.clusterId, o]),
  )

  const candidate = selectAuthCandidate(
    report.authCandidates,
    decisions.selectedAuthCandidateId,
  )
  const context = buildSiteContext(candidate, decisions.selectedAuthCandidateId)

  const operations = report.clusters
    .filter((c) => !excluded.has(c.id))
    .map((c) => curateOperation(c, overridesMap.get(c.id)))

  const ws = report.ws ? buildWsPlan(report.ws) : undefined

  const extractionSignals =
    report.extractionSignals.length > 0 ? report.extractionSignals : undefined

  return {
    site: report.site,
    sourceUrl: report.sourceUrl,
    context,
    operations,
    extractionSignals,
    ws,
  }
}
