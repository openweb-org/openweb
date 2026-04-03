/**
 * Pipeline v2 type definitions.
 *
 * These types define the contracts for the 5-phase pipeline:
 * Capture -> Analyze -> Curate -> Generate -> Verify
 */

import type { JsonSchema } from '../lib/openapi.js'
import type { PermissionCategory, Transport } from '../types/extensions.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../types/primitives.js'
import type { WsMessageTemplate } from '../types/ws-primitives.js'
import type { ExtractionSignal } from './analyzer/classify.js'
import type { ParameterDescriptor, RecordedRequestSample, SampleResponse } from './types.js'

// ---------------------------------------------------------------------------
// Phase 1: Capture
// ---------------------------------------------------------------------------

/** Typed output of Capture and input of Analyze. */
export interface CaptureBundle {
  readonly site: string
  readonly sourceUrl: string
  readonly captureDir: string
  readonly harPath: string
  readonly wsFramesPath?: string
  readonly stateSnapshotDir?: string
  readonly domHtmlPath?: string
  readonly allowHosts?: readonly string[]
}

// ---------------------------------------------------------------------------
// Phase 2: Analyze — samples
// ---------------------------------------------------------------------------

/** Traffic category assigned during labeling. */
export type SampleCategory = 'api' | 'static' | 'tracking' | 'off_domain'

/** A captured sample with its assigned category and reasoning. */
export interface LabeledSample {
  readonly id: string
  readonly sample: RecordedRequestSample
  readonly category: SampleCategory
  readonly responseKind: SampleResponse['kind']
  readonly reasons: readonly string[]
}

// ---------------------------------------------------------------------------
// Phase 2: Analyze — auth
// ---------------------------------------------------------------------------

/** Evidence supporting an auth candidate's ranking. */
export interface AuthEvidence {
  readonly matchedEntries: number
  readonly totalEntries: number
  readonly matchedCookies?: readonly string[]
  readonly storageKeys?: readonly string[]
  readonly tokenEndpoints?: readonly string[]
  readonly headerBindings?: ReadonlyArray<{
    readonly cookie: string
    readonly header: string
  }>
  readonly rejectedSignals?: readonly string[]
  readonly notes: readonly string[]
}

/** A ranked, bundled site auth proposal. */
export interface AuthCandidate {
  readonly id: string
  readonly rank: number
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive
  readonly signing?: SigningPrimitive
  readonly confidence: number
  readonly evidence: AuthEvidence
}

// ---------------------------------------------------------------------------
// Phase 2: Analyze — clusters
// ---------------------------------------------------------------------------

/** Status/kind-aware response modeling per cluster. */
export interface ResponseVariant {
  readonly status: number
  readonly kind: SampleResponse['kind']
  readonly contentType: string
  readonly sampleCount: number
  readonly schema?: JsonSchema
}

/** Audit trail for path template normalization. */
export interface PathNormalization {
  readonly originalPaths: readonly string[]
  readonly normalizedSegments: ReadonlyArray<{
    readonly index: number
    readonly kind: 'numeric' | 'uuid' | 'hex' | 'urn' | 'learned'
  }>
}

/** GraphQL sub-clustering metadata. */
export interface GraphqlClusterInfo {
  readonly endpointPath: string
  readonly operationType?: 'query' | 'mutation' | 'subscription'
  readonly operationName?: string
  readonly queryId?: string
  readonly persistedQueryHash?: string
  readonly discriminator: 'operationName' | 'queryId' | 'persistedQueryHash' | 'queryShape'
}

/** A group of samples sharing one logical endpoint. */
export interface ClusteredEndpoint {
  readonly id: string
  readonly method: string
  readonly host: string
  readonly pathTemplate: string
  readonly sampleIds: readonly string[]
  readonly sampleCount: number
  readonly normalization?: PathNormalization
  readonly graphql?: GraphqlClusterInfo
  readonly parameters: readonly ParameterDescriptor[]
  readonly responseVariants: readonly ResponseVariant[]
  readonly requestBodySchema?: JsonSchema
  readonly suggestedOperationId: string
  readonly suggestedSummary: string
}

// ---------------------------------------------------------------------------
// Phase 2: Analyze — navigation & WebSocket
// ---------------------------------------------------------------------------

/** A single request within a navigation group. */
export interface NavigationRequest {
  readonly sampleId: string
  readonly host: string
  readonly path: string
  readonly method: string
  readonly status: number
  readonly category: SampleCategory
  readonly responseKind: SampleResponse['kind']
  readonly contentType: string
}

/** A page-level grouping of captured requests. */
export interface NavigationGroup {
  readonly id: string
  readonly page: string
  readonly timestamp: string
  readonly sampleIds: readonly string[]
  readonly requests: readonly NavigationRequest[]
}

/** A detected WebSocket heartbeat pattern. */
export interface WsHeartbeatCandidate {
  readonly direction: 'send' | 'receive'
  readonly intervalMs: number
  readonly payload: unknown
}

/** Summary of a WS operation discovered during analysis. */
export interface WsOperationSummary {
  readonly operationId: string
  readonly pattern: 'subscribe' | 'publish' | 'request_reply' | 'stream'
  readonly direction: 'sent' | 'received'
  readonly messageTemplate?: WsMessageTemplate
}

/** Analysis summary for a single WebSocket connection. */
export interface WsConnectionAnalysis {
  readonly id: string
  readonly url: string
  readonly sampleCount: number
  readonly executableOperationCount: number
  readonly operations: readonly WsOperationSummary[]
  readonly heartbeatCandidates: readonly WsHeartbeatCandidate[]
}

// ---------------------------------------------------------------------------
// Phase 2: Analyze — report
// ---------------------------------------------------------------------------

/** Single report replacing filtered.json, clusters.json, classify.json, probe.json, summary.txt. */
export interface AnalysisReport {
  readonly version: 2
  readonly site: string
  readonly sourceUrl: string
  readonly generatedAt: string
  readonly summary: {
    readonly totalSamples: number
    readonly malformedSamples: number
    readonly byCategory: Readonly<Record<SampleCategory, number>>
    readonly byResponseKind: Readonly<Record<SampleResponse['kind'], number>>
    readonly clusterCount: number
  }
  readonly navigation: readonly NavigationGroup[]
  readonly samples: readonly LabeledSample[]
  readonly clusters: readonly ClusteredEndpoint[]
  readonly authCandidates: readonly AuthCandidate[]
  readonly csrfOptions: readonly CsrfPrimitive[]
  readonly extractionSignals: readonly ExtractionSignal[]
  readonly ws?: {
    readonly connections: readonly WsConnectionAnalysis[]
    readonly heartbeatCandidates: readonly WsHeartbeatCandidate[]
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Curate
// ---------------------------------------------------------------------------

/** Agent decisions applied to an AnalysisReport to produce a compile plan. */
export interface CurationDecisionSet {
  readonly selectedAuthCandidateId?: string
  readonly excludedClusterIds?: readonly string[]
  readonly csrfType?: 'cookie_to_header' | 'meta_tag'
  /** Explicit CSRF override — pick by cookie+header name from csrfOptions */
  readonly csrfOverride?: { readonly cookie: string; readonly header: string }
  readonly operationOverrides?: ReadonlyArray<{
    readonly clusterId: string
    readonly operationId?: string
    readonly summary?: string
    readonly permission?: PermissionCategory
    // TODO: Add 'safe_mutation' for idempotent/reversible writes (like, follow, bookmark)
    // that are safe to replay during verify. Currently all non-read ops are unsafe_mutation.
    // See doc/internal/todo/verify-unify/design.md "Future: safe_mutation and --write flag"
    readonly replaySafety?: 'safe_read' | 'unsafe_mutation'
    readonly exampleInput?: Record<string, unknown>
    readonly exampleRequestBody?: unknown
  }>
}

/** Resolved site-level auth and transport context. */
export interface CuratedSiteContext {
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive
  readonly signing?: SigningPrimitive
  readonly selectedAuthCandidateId?: string
}

/** A fully curated HTTP operation ready for generation. */
export interface CuratedOperation {
  readonly id: string
  readonly sourceClusterIds: readonly string[]
  readonly method: string
  readonly host: string
  readonly pathTemplate: string
  readonly operationId: string
  readonly summary: string
  readonly permission: PermissionCategory
  // TODO: Add 'safe_mutation' for idempotent/reversible writes (like, follow, bookmark)
  // that are safe to replay during verify. Currently all non-read ops are unsafe_mutation.
  // See doc/internal/todo/verify-unify/design.md "Future: safe_mutation and --write flag"
  readonly replaySafety: 'safe_read' | 'unsafe_mutation'
  readonly parameters: readonly ParameterDescriptor[]
  readonly responseVariants: readonly ResponseVariant[]
  readonly requestBodySchema?: JsonSchema
  readonly exampleInput: Record<string, unknown>
  readonly exampleRequestBody?: unknown
  readonly curationNotes?: readonly string[]
}

/** A curated WebSocket operation. */
export interface CuratedWsOperation {
  readonly id: string
  readonly name: string
  readonly pattern: 'subscribe' | 'publish' | 'request_reply' | 'stream'
  readonly messageTemplate?: WsMessageTemplate
}

/** Curated WebSocket plan including heartbeat. */
export interface CuratedWsPlan {
  readonly serverUrl: string
  readonly heartbeat?: WsHeartbeatCandidate
  readonly operations: readonly CuratedWsOperation[]
}

/** Complete curated plan consumed by Generate. */
export interface CuratedCompilePlan {
  readonly site: string
  readonly sourceUrl: string
  readonly context: CuratedSiteContext
  readonly operations: readonly CuratedOperation[]
  readonly extractionSignals?: readonly ExtractionSignal[]
  readonly ws?: CuratedWsPlan
}
