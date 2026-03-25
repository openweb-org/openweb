import type { JsonSchema } from '../../lib/openapi.js'
import type { WsPattern, WsMessageTemplate, WsBinding } from '../../types/ws-primitives.js'
import { inferSchema } from '../analyzer/schema.js'
import type { ClassifiedCluster } from './ws-classify.js'

// ── Output types ──────────────────────────────────────────────

export interface WsOperationSchema {
  readonly operationId: string
  readonly pattern: WsPattern
  readonly direction: 'sent' | 'received'
  readonly payloadSchema: JsonSchema
  readonly parameterSchema?: JsonSchema
  readonly messageTemplate?: WsMessageTemplate
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
 * Analyze sent frames for subscribe patterns: separate constant vs varying fields.
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

// ── Main entry ────────────────────────────────────────────────

export function inferWsSchemas(clusters: ClassifiedCluster[]): WsOperationSchema[] {
  const results: WsOperationSchema[] = []

  for (const cluster of clusters) {
    if (cluster.frames.length === 0) continue

    const payloads = cluster.frames.map((f) => f.payload)
    const payloadSchema = inferSchema(payloads)
    const operationId = generateOperationId(cluster)

    let parameterSchema: JsonSchema | undefined
    let messageTemplate: WsMessageTemplate | undefined

    // For subscribe patterns on sent clusters, extract parameters from varying fields
    if (cluster.pattern === 'subscribe' && cluster.direction === 'sent') {
      const extracted = extractTemplateAndParameters(payloads)
      if (extracted) {
        parameterSchema = extracted.parameterSchema
        messageTemplate = extracted.template
      }
    }

    results.push({
      operationId,
      pattern: cluster.pattern,
      direction: cluster.direction,
      payloadSchema,
      parameterSchema,
      messageTemplate,
    })
  }

  return results
}
