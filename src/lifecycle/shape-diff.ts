import type { JsonSchema } from '../lib/openapi.js'

const MAX_DEPTH = 3
const SAMPLE_SIZE = 3

export interface DriftResult {
  readonly kind: 'type_change' | 'required_missing' | 'schema_mismatch'
  readonly path: string
  readonly expected?: string
  readonly actual?: string
}

/**
 * Recursively extract field paths and their JS types from a response value.
 * Arrays: merge first SAMPLE_SIZE items' fields as superset, prefix with '[]'.
 * null values: key counts as present (for required check) but type is not recorded.
 * number/integer both normalize to 'number'.
 */
export function extractFields(
  value: unknown,
  prefix = '',
  depth = 0,
): Record<string, string> {
  if (depth > MAX_DEPTH) return {}
  if (value === null || value === undefined) return {}

  if (Array.isArray(value)) {
    const merged: Record<string, string> = {}
    for (const item of value.slice(0, SAMPLE_SIZE)) {
      const itemFields = extractFields(item, `${prefix}[]`, depth + 1)
      for (const [p, t] of Object.entries(itemFields)) {
        if (!(p in merged)) merged[p] = t
      }
    }
    return merged
  }

  if (typeof value === 'object') {
    const fields: Record<string, string> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (v === null) continue
      fields[fullPath] = Array.isArray(v) ? 'array' : normalizeType(typeof v)
      if (typeof v === 'object') {
        Object.assign(fields, extractFields(v, fullPath, depth + 1))
      }
    }
    return fields
  }

  // Primitive top-level
  return { [prefix || '']: normalizeType(typeof value) }
}

/**
 * Extract field paths and types from an OpenAPI JSON Schema.
 * Walks properties/items recursively, mirrors extractFields path format.
 */
export function extractSchemaFields(
  schema: JsonSchema,
  prefix = '',
  depth = 0,
): Record<string, string> {
  if (depth > MAX_DEPTH) return {}

  const type = resolveSchemaType(schema)

  if (type === 'array' && schema.items) {
    return extractSchemaFields(schema.items, `${prefix}[]`, depth + 1)
  }

  if (type === 'object' && schema.properties) {
    const fields: Record<string, string> = {}
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key
      const propType = resolveSchemaType(propSchema)
      if (propType) fields[fullPath] = normalizeType(propType)
      if (propType === 'object' || propType === 'array') {
        Object.assign(fields, extractSchemaFields(propSchema, fullPath, depth + 1))
      }
    }
    return fields
  }

  // Primitive schema at top level (not bare object/array without structure)
  if (type && !prefix && type !== 'object' && type !== 'array') return { '': normalizeType(type) }
  return {}
}

/**
 * Extract required field paths from an OpenAPI schema.
 * Walks nested objects/arrays to collect all required paths.
 */
export function extractRequiredFields(
  schema: JsonSchema,
  prefix = '',
  depth = 0,
): Set<string> {
  if (depth > MAX_DEPTH) return new Set()

  const type = resolveSchemaType(schema)
  const result = new Set<string>()

  if (type === 'array' && schema.items) {
    for (const p of extractRequiredFields(schema.items, `${prefix}[]`, depth + 1)) {
      result.add(p)
    }
    return result
  }

  if (type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? [])
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key
      if (required.has(key)) result.add(fullPath)
      const propType = resolveSchemaType(propSchema)
      if (propType === 'object' || propType === 'array') {
        for (const p of extractRequiredFields(propSchema, fullPath, depth + 1)) {
          result.add(p)
        }
      }
    }
  }

  return result
}

/**
 * Compare response fields against schema fields.
 * Returns DriftResult[] for type mismatches and missing required fields.
 * Response fields not in schema are ignored (not drift).
 */
export function diffShape(
  schemaFields: Record<string, string>,
  responseFields: Record<string, string>,
  requiredFields: Set<string>,
): DriftResult[] {
  const drifts: DriftResult[] = []

  // Phase 1: type changes — response field exists in schema but type differs
  for (const [path, actualType] of Object.entries(responseFields)) {
    const expectedType = schemaFields[path]
    if (expectedType && actualType !== expectedType) {
      drifts.push({ kind: 'type_change', path, expected: expectedType, actual: actualType })
    }
  }

  // Phase 2: required fields missing from response
  for (const path of requiredFields) {
    if (!(path in responseFields)) {
      drifts.push({ kind: 'required_missing', path })
    }
  }

  // Phase 3: zero-overlap check — schema has fields but none appear in response
  const schemaKeys = Object.keys(schemaFields)
  if (schemaKeys.length > 0) {
    const overlap = schemaKeys.filter((k) => k in responseFields).length
    if (overlap === 0) {
      drifts.push({ kind: 'schema_mismatch', path: '', expected: `${schemaKeys.length} schema fields`, actual: '0 matched' })
    }
  }

  return drifts
}

function normalizeType(t: string): string {
  return t === 'integer' ? 'number' : t
}

function resolveSchemaType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    // Pick first non-null type
    return schema.type.find((t) => t !== 'null')
  }
  // Infer from structure
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  return undefined
}
