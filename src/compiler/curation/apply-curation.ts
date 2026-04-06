/**
 * Curation: transforms AnalysisReport into CuratedCompilePlan with sensible defaults.
 *
 * Pure function — same input always produces the same output.
 */

import type { PermissionCategory } from '../../types/extensions.js'
import type { WsMessageTemplate } from '../../types/ws-primitives.js'
import type {
  AnalysisReport,
  AuthCandidate,
  ClusteredEndpoint,
  CuratedCompilePlan,
  CuratedOperation,
  CuratedSiteContext,
  CuratedWsOperation,
  CuratedWsPlan,
} from '../types-v2.js'
import { scrubExamples, scrubRequestBody } from './scrub.js'

function selectAuthCandidate(
  candidates: readonly AuthCandidate[],
): AuthCandidate | undefined {
  if (candidates.length === 0) return undefined
  // Highest rank = lowest rank number (rank 1 is best)
  return [...candidates].sort((a, b) => a.rank - b.rank)[0]
}

function buildSiteContext(candidate: AuthCandidate | undefined): CuratedSiteContext {
  if (!candidate) return { transport: 'node' }

  return {
    transport: candidate.transport,
    auth: candidate.auth,
    csrf: candidate.csrf,
    signing: candidate.signing,
    selectedAuthCandidateId: candidate.id,
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

function curateOperation(cluster: ClusteredEndpoint): CuratedOperation {
  const exampleInput = scrubExamples(buildExampleInput(cluster))

  return {
    id: cluster.id,
    sourceClusterIds: [cluster.id],
    method: cluster.method,
    host: cluster.host,
    pathTemplate: cluster.pathTemplate,
    operationId: cluster.suggestedOperationId,
    summary: cluster.suggestedSummary,
    permission: defaultPermission(cluster),
    replaySafety: defaultReplaySafety(cluster),
    parameters: cluster.parameters,
    responseVariants: cluster.responseVariants,
    requestBodySchema: cluster.requestBodySchema,
    exampleInput,
  }
}

function scrubMessageTemplate(tmpl: WsMessageTemplate): WsMessageTemplate {
  return {
    constants: scrubRequestBody(tmpl.constants) as Readonly<Record<string, unknown>>,
    bindings: tmpl.bindings,
  }
}

function buildWsPlan(ws: NonNullable<AnalysisReport['ws']>): CuratedWsPlan {
  const firstConnection = ws.connections.find((c) => c.url) ?? ws.connections[0]
  if (!firstConnection || !firstConnection.url) {
    return { serverUrl: '', operations: [] }
  }

  // Flatten operations from all connections, using analysis-derived pattern/name
  const operations: CuratedWsOperation[] = []
  for (const conn of ws.connections) {
    for (const op of conn.operations) {
      operations.push({
        id: op.operationId,
        name: op.operationId,
        pattern: op.pattern,
        messageTemplate: op.messageTemplate ? scrubMessageTemplate(op.messageTemplate) : undefined,
      })
    }
  }

  return {
    serverUrl: firstConnection.url,
    heartbeat: ws.heartbeatCandidates[0],
    operations,
  }
}

/** Transform an AnalysisReport into a CuratedCompilePlan with sensible defaults. */
export function buildCompilePlan(report: AnalysisReport): CuratedCompilePlan {
  const candidate = selectAuthCandidate(report.authCandidates)
  const context = buildSiteContext(candidate)

  const operations = report.clusters.map((c) => curateOperation(c))

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
