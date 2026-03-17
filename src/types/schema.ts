// JSON Schema definitions for x-openweb extensions and manifest.json.
// Primitive schemas live in primitive-schemas.ts — this file composes them.

import {
  authPrimitiveSchema,
  csrfWithScopeSchema,
  extractionPrimitiveSchema,
  paginationPrimitiveSchema,
  signingPrimitiveSchema,
} from './primitive-schemas.js'

const adapterRefSchema = {
  type: 'object',
  required: ['name', 'operation'],
  properties: {
    name: { type: 'string' },
    operation: { type: 'string' },
    params: { type: 'object' },
  },
  additionalProperties: false,
} as const

const transportSchema = {
  enum: ['node', 'page'],
} as const

const permissionSchema = {
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
  },
  additionalProperties: false,
} as const

const buildMetaSchema = {
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

export const xOpenWebOperationSchema = {
  type: 'object',
  properties: {
    permission: permissionSchema,
    build: buildMetaSchema,
    transport: transportSchema,
    csrf: csrfWithScopeSchema,
    pagination: paginationPrimitiveSchema,
    extraction: extractionPrimitiveSchema,
    adapter: adapterRefSchema,
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
      required: ['operation_count', 'l1_count', 'l2_count', 'l3_count'],
      properties: {
        operation_count: { type: 'integer', minimum: 0 },
        l1_count: { type: 'integer', minimum: 0 },
        l2_count: { type: 'integer', minimum: 0 },
        l3_count: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    last_verified: { type: 'string' },
    quarantined: { type: 'boolean' },
  },
  additionalProperties: false,
} as const
