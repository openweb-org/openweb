// JSON Schema definitions for x-openweb extensions and manifest.json.
// Primitive schemas live in primitive-schemas.ts — this file composes them.

import {
  authPrimitiveSchema,
  csrfWithScopeSchema,
  extractionPrimitiveSchema,
  paginationPrimitiveSchema,
  signingPrimitiveSchema,
  wsAuthConfigSchema,
  wsDiscriminatorConfigSchema,
  wsHeartbeatSchema,
  wsMessageTemplateSchema,
  wsPatternSchema,
} from './primitive-schemas.js'

export const adapterRefSchema = {
  type: 'object',
  required: ['name', 'operation'],
  properties: {
    name: { type: 'string' },
    operation: { type: 'string' },
    params: { type: 'object' },
  },
  additionalProperties: false,
} as const

export const transportSchema = {
  enum: ['node', 'page'],
} as const

export const permissionSchema = {
  enum: ['read', 'write', 'delete', 'transact'],
} as const

// ── Server-level x-openweb ─────────────────────────

export const xOpenWebServerSchema = {
  type: 'object',
  required: ['transport'],
  properties: {
    transport: transportSchema,
    auth: authPrimitiveSchema,
    csrf: csrfWithScopeSchema,
    signing: signingPrimitiveSchema,
    headers: { type: 'object', additionalProperties: { type: 'string' } },
  },
  additionalProperties: false,
} as const

export const buildMetaSchema = {
  type: 'object',
  properties: {
    stable_id: { type: 'string' },
    signature_id: { type: 'string' },
    tool_version: { type: 'integer', minimum: 1 },
    verified: { type: 'boolean' },
    signals: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const

// ── Operation-level x-openweb ──────────────────────

export const safetySchema = {
  enum: ['safe', 'caution'],
} as const

export const xOpenWebOperationSchema = {
  type: 'object',
  properties: {
    permission: permissionSchema,
    safety: safetySchema,
    requires_auth: { type: 'boolean' },
    build: buildMetaSchema,
    transport: transportSchema,
    auth: { oneOf: [authPrimitiveSchema, { const: false }] },
    csrf: { oneOf: [csrfWithScopeSchema, { const: false }] },
    signing: { oneOf: [signingPrimitiveSchema, { const: false }] },
    pagination: paginationPrimitiveSchema,
    extraction: extractionPrimitiveSchema,
    adapter: adapterRefSchema,
    actual_path: { type: 'string' },
    unwrap: { type: 'string' },
    wrap: { type: 'string' },
    graphql_query: { type: 'string' },
  },
  additionalProperties: false,
} as const

// ── manifest.json ──────────────────────────────────

export const manifestSchema = {
  type: 'object',
  required: ['name', 'version', 'spec_version'],
  properties: {
    name: { type: 'string' },
    display_name: { type: 'string' },
    version: { type: 'string' },
    spec_version: { type: 'string' },
    compiled_at: { type: 'string' },
    compiler_version: { type: 'string' },
    site_url: { type: 'string' },
    description: { type: 'string' },
    requires_auth: { type: 'boolean' },
    fingerprint: {
      type: 'object',
      properties: {
        js_bundle_hash: { type: 'string' },
        api_endpoint_set_hash: { type: 'string' },
        response_shape_hash: { type: 'string' },
        last_validated: { type: 'string' },
      },
      additionalProperties: false,
    },
    dependencies: {
      type: 'object',
      additionalProperties: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    },
    stats: {
      type: 'object',
      required: ['operation_count', 'l1_count', 'l2_count', 'l3_count', 'ws_count'],
      properties: {
        operation_count: { type: 'integer', minimum: 0 },
        l1_count: { type: 'integer', minimum: 0 },
        l2_count: { type: 'integer', minimum: 0 },
        l3_count: { type: 'integer', minimum: 0 },
        ws_count: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    last_verified: { type: 'string' },
    quarantined: { type: 'boolean' },
  },
  additionalProperties: false,
} as const

// ── WS Server-level x-openweb ─────────────────────

export const wsReconnectSchema = {
  type: 'object',
  required: ['max_retries', 'backoff_ms'],
  properties: {
    max_retries: { type: 'integer', minimum: 0 },
    backoff_ms: { type: 'number', minimum: 0 },
    resume_field: { type: 'string' },
  },
  additionalProperties: false,
} as const

export const xOpenWebWsServerSchema = {
  type: 'object',
  required: ['transport', 'discriminator'],
  properties: {
    transport: transportSchema,
    auth: wsAuthConfigSchema,
    heartbeat: wsHeartbeatSchema,
    discriminator: wsDiscriminatorConfigSchema,
    reconnect: wsReconnectSchema,
  },
  additionalProperties: false,
} as const

// ── WS Operation-level x-openweb ──────────────────

export const wsCorrelationSchema = {
  type: 'object',
  required: ['field', 'source'],
  properties: {
    field: { type: 'string' },
    source: { enum: ['echo', 'sequence', 'uuid'] },
  },
  additionalProperties: false,
} as const

export const xOpenWebWsOperationSchema = {
  type: 'object',
  required: ['permission', 'pattern'],
  properties: {
    permission: permissionSchema,
    pattern: wsPatternSchema,
    subscribe_message: wsMessageTemplateSchema,
    unsubscribe_message: wsMessageTemplateSchema,
    correlation: wsCorrelationSchema,
    event_match: { type: 'object' },
    build: buildMetaSchema,
  },
  additionalProperties: false,
} as const

// ── AsyncAPI 3.0 spec (structural validation) ─────

export const asyncApiSpecSchema = {
  type: 'object',
  required: ['asyncapi', 'info'],
  properties: {
    asyncapi: { type: 'string', pattern: '^3\\.' },
    info: {
      type: 'object',
      required: ['title', 'version'],
      properties: {
        title: { type: 'string' },
        version: { type: 'string' },
        'x-openweb': { type: 'object' },
      },
    },
    servers: { type: 'object' },
    channels: { type: 'object' },
    operations: { type: 'object' },
    components: { type: 'object' },
  },
} as const
