import type { JsonSchema } from '../../lib/spec-loader.js'
import type { WsBinding, WsMessageTemplate, WsPattern } from '../../types/ws-primitives.js'
import { inferSchema } from '../analyzer/schema.js'
import { CORRELATION_FIELDS, type ClassifiedCluster } from './ws-classify.js'

// ── Output types ──────────────────────────────────────────────

export interface WsOperationSchema {
  readonly operationId: string
  readonly pattern: WsPattern
  readonly direction: 'sent' | 'received'
  readonly payloadSchema: JsonSchema
  readonly parameterSchema?: JsonSchema
  readonly messageTemplate?: WsMessageTemplate
  readonly correlationConfig?: { readonly field: string; readonly source: 'echo' | 'sequence' | 'uuid' }
  readonly eventMatch?: Record<string, unknown>
  readonly unsubscribeTemplate?: WsMessageTemplate
}

// ── Helpers ───────────────────────────────────────────────────

/** Generate a stable operationId from cluster discriminator + direction. */
function generateOperationId(cluster: ClassifiedCluster): string {
  const dir = cluster.direction === 'sent' ? 'send' : 'recv'
  const disc = String(cluster.discriminatorValue).replace(/[^a-zA-Z0-9_]/g, '_')
  const sub = cluster.subValue != null ? `_${String(cluster.subValue).replace(/[^a-zA-Z0-9_]/g, '_')}` : ''
  return `ws_${dir}_${disc}${sub}`
}

/**
 * Analyze sent frames: separate constant vs varying fields.
 * Constant fields → template constants. Varying fields → parameter bindings.
 */
function extractTemplateAndParameters(
  payloads: Record<string, unknown>[],
): { template: WsMessageTemplate; parameterSchema: JsonSchema } | null {
  if (payloads.length === 0) return null

  const allKeys = new Set<string>()
  for (const p of payloads) {
    for (const key of Object.keys(p)) allKeys.add(key)
  }

  const constants: Record<string, unknown> = {}
  const bindings: WsBinding[] = []
  const paramProperties: Record<string, JsonSchema> = {}
  const paramRequired: string[] = []

  for (const key of allKeys) {
    const values = payloads.map((p) => p[key]).filter((v) => v !== undefined)
    const distinct = new Set(values.map((v) => JSON.stringify(v)))

    if (distinct.size <= 1 && values.length === payloads.length) {
      // Same value in every frame → constant
      constants[key] = values[0]
    } else {
      // Varying across frames → parameter
      bindings.push({ path: key, source: 'param', key })
      paramProperties[key] = inferSchema(values)
      if (values.length === payloads.length) {
        paramRequired.push(key)
      }
    }
  }

  if (bindings.length === 0) return null

  const parameterSchema: JsonSchema = {
    type: 'object',
    properties: paramProperties,
    required: paramRequired,
  }

  return {
    template: { constants, bindings },
    parameterSchema,
  }
}

// ── Correlation Inference ─────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function detectCorrelationField(
  payloads: Record<string, unknown>[],
): { field: string; source: 'echo' | 'sequence' | 'uuid' } | undefined {
  for (const field of CORRELATION_FIELDS) {
    const values = payloads.map((p) => p[field]).filter((v) => v !== undefined)
    if (values.length === 0) continue
    const distinct = new Set(values.map((v) => JSON.stringify(v)))
    if (distinct.size !== values.length) continue // not unique per frame

    // Determine source type
    if (values.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
      return { field, source: 'uuid' }
    }
    if (values.every((v) => typeof v === 'number') && isIncrementing(values as number[])) {
      return { field, source: 'sequence' }
    }
    return { field, source: 'echo' }
  }
  return undefined
}

function isIncrementing(nums: number[]): boolean {
  if (nums.length < 2) return true
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) return false
  }
  return true
}

// ── Unsubscribe Pairing ──────────────────────────────────────

function pairUnsubscribe(
  sub: ClassifiedCluster,
  allSent: ClassifiedCluster[],
): ClassifiedCluster | undefined {
  for (const other of allSent) {
    if (other === sub || other.pattern !== 'publish') continue
    const candDisc = String(other.discriminatorValue).toLowerCase()
    if (candDisc.includes('unsub') || candDisc.includes('remove')) return other
  }
  return undefined
}

// ── Main entry ────────────────────────────────────────────────

export function inferWsSchemas(clusters: ClassifiedCluster[]): WsOperationSchema[] {
  const results: WsOperationSchema[] = []
  const sentClusters = clusters.filter((c) => c.direction === 'sent')

  for (const cluster of clusters) {
    if (cluster.frames.length === 0) continue

    const payloads = cluster.frames.map((f) => f.payload)
    const payloadSchema = inferSchema(payloads)
    const operationId = generateOperationId(cluster)

    let parameterSchema: JsonSchema | undefined
    let messageTemplate: WsMessageTemplate | undefined
    let correlationConfig: WsOperationSchema['correlationConfig']
    let eventMatch: Record<string, unknown> | undefined
    let unsubscribeTemplate: WsMessageTemplate | undefined

    // Template extraction for sent executable patterns
    if (cluster.direction === 'sent' &&
        (cluster.pattern === 'subscribe' || cluster.pattern === 'publish' || cluster.pattern === 'request_reply')) {
      const extracted = extractTemplateAndParameters(payloads)
      if (extracted) {
        parameterSchema = extracted.parameterSchema
        messageTemplate = extracted.template
      }
    }

    // Correlation inference for request_reply sent clusters
    if (cluster.direction === 'sent' && cluster.pattern === 'request_reply') {
      correlationConfig = detectCorrelationField(payloads)
    }

    // Event match inference for receive-side clusters
    if (cluster.direction === 'received') {
      eventMatch = {}
      if (cluster.discriminatorField) {
        eventMatch[cluster.discriminatorField] = cluster.discriminatorValue
      }
      if (cluster.subValue != null && cluster.subField) {
        eventMatch[cluster.subField] = cluster.subValue
      }
      // Only emit if we have at least one match field
      if (Object.keys(eventMatch).length === 0) {
        eventMatch = undefined
      }
    }

    // Unsubscribe pairing for subscribe sent clusters
    if (cluster.direction === 'sent' && cluster.pattern === 'subscribe') {
      const unsub = pairUnsubscribe(cluster, sentClusters)
      if (unsub) {
        const unsubPayloads = unsub.frames.map((f) => f.payload)
        const extracted = extractTemplateAndParameters(unsubPayloads)
        if (extracted) {
          unsubscribeTemplate = extracted.template
        }
      }
    }

    results.push({
      operationId,
      pattern: cluster.pattern,
      direction: cluster.direction,
      payloadSchema,
      parameterSchema,
      messageTemplate,
      correlationConfig,
      eventMatch,
      unsubscribeTemplate,
    })
  }

  return results
}
