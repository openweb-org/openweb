import { logger } from '../../lib/logger.js'
import type { JsonSchema } from '../../lib/spec-loader.js'

export interface SchemaOptions {
  /** Maximum object nesting depth. Default: 10 */
  maxDepth?: number
  /** Maximum properties per object level. Default: 100 */
  maxProperties?: number
  /** Maximum array items to sample for item schema inference. Default: 50 */
  maxArraySample?: number
  /** Label for diagnostic messages (e.g., operationId) */
  label?: string
}

const DEFAULT_OPTIONS: Required<SchemaOptions> = {
  maxDepth: 10,
  maxProperties: 100,
  maxArraySample: 50,
}

const FORMAT_PATTERNS: ReadonlyArray<{ format: string; regex: RegExp }> = [
  { format: 'date-time', regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ },
  { format: 'date', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { format: 'uuid', regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { format: 'email', regex: /^[^@]+@[^@]+\.[^@]+$/ },
  { format: 'uri', regex: /^https?:\/\// },
]

const MAX_ENUM_VALUES = 10

function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function detectFormat(values: string[]): string | undefined {
  if (values.length === 0) return undefined
  for (const { format, regex } of FORMAT_PATTERNS) {
    if (values.every((v) => regex.test(v))) return format
  }
  return undefined
}

function detectEnum(values: string[]): string[] | undefined {
  if (values.length === 0) return undefined
  const unique = Array.from(new Set(values))
  if (unique.length <= MAX_ENUM_VALUES) return unique.sort()
  return undefined
}

function inferSingleKind(
  kind: string,
  samples: unknown[],
  opts: Required<SchemaOptions>,
  depth: number,
): JsonSchema {
  if (kind === 'string') {
    const strings = samples.filter((s): s is string => typeof s === 'string')
    const format = detectFormat(strings)
    if (format) return { type: 'string', format }
    const enumValues = detectEnum(strings)
    if (enumValues) return { type: 'string', enum: enumValues }
    return { type: 'string' }
  }

  if (kind === 'array') {
    if (depth >= opts.maxDepth) return { type: 'array' }
    const allItems = samples.flatMap((s) => (Array.isArray(s) ? s : []))
    if (allItems.length === 0 && opts.label) {
      logger.warn(`${opts.label}: empty array response — schema inference produces bare type: object`)
    }
    const sampled = allItems.length > opts.maxArraySample ? allItems.slice(0, opts.maxArraySample) : allItems
    return { type: 'array', items: infer(sampled, opts, depth + 1) }
  }

  if (kind === 'object') {
    if (depth >= opts.maxDepth) return { type: 'object' }

    const objects = samples.filter(
      (s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && !Array.isArray(s)),
    )

    const keySet = new Set<string>()
    for (const obj of objects) {
      for (const key of Object.keys(obj)) keySet.add(key)
    }

    let keys = Array.from(keySet)
    let truncated = false
    if (keys.length > opts.maxProperties) {
      keys = keys.slice(0, opts.maxProperties)
      truncated = true
    }

    const properties: Record<string, JsonSchema> = {}
    const required = objects.length >= 2
      ? new Set<string>(Object.keys(objects[0] ?? {}))
      : new Set<string>()

    for (const key of keys) {
      const values = objects.map((o) => o[key]).filter((v) => v !== undefined)
      properties[key] = infer(values, opts, depth + 1)
      if (objects.some((o) => !(key in o))) required.delete(key)
    }

    const schema: JsonSchema = {
      type: 'object',
      properties,
      required: Array.from(required).filter((k) => keys.includes(k)),
    }

    if (truncated) {
      ;(schema as Record<string, unknown>).additionalProperties = true
      ;(schema as Record<string, unknown>)['x-truncated'] = true
    }

    return schema
  }

  if (kind === 'integer') return { type: 'integer' }
  return { type: kind }
}

function unionKinds(
  samples: unknown[],
  kinds: string[],
  opts: Required<SchemaOptions>,
  depth: number,
): JsonSchema {
  if (kinds.length === 1) return inferSingleKind(kinds[0], samples, opts, depth)
  if (kinds.every((k) => k === 'integer' || k === 'number')) return { type: 'number' }
  return {
    anyOf: kinds.map((k) =>
      inferSingleKind(k, samples.filter((s) => kindOf(s) === k), opts, depth),
    ),
  }
}

function infer(samples: unknown[], opts: Required<SchemaOptions>, depth: number): JsonSchema {
  if (samples.length === 0) return { type: 'object' }
  const kinds = Array.from(new Set(samples.map(kindOf)))
  return unionKinds(samples, kinds, opts, depth)
}

export function inferSchema(samples: unknown[], options?: SchemaOptions): JsonSchema {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return infer(samples, opts, 0)
}
