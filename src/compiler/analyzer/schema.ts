import type { JsonSchema } from '../../lib/openapi.js'

function kindOf(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }
  return typeof value
}

function inferSingleKind(kind: string, samples: unknown[]): JsonSchema {
  if (kind === 'array') {
    const items = samples.flatMap((sample) => (Array.isArray(sample) ? sample : []))
    return {
      type: 'array',
      items: inferSchema(items),
    }
  }

  if (kind === 'object') {
    const objects = samples.filter(
      (sample): sample is Record<string, unknown> => Boolean(sample && typeof sample === 'object' && !Array.isArray(sample)),
    )

    const keySet = new Set<string>()
    for (const objectItem of objects) {
      for (const key of Object.keys(objectItem)) {
        keySet.add(key)
      }
    }

    const properties: Record<string, JsonSchema> = {}
    const required = new Set<string>(Object.keys(objects[0] ?? {}))

    for (const key of keySet) {
      const values = objects.map((item) => item[key]).filter((value) => value !== undefined)
      properties[key] = inferSchema(values)

      if (objects.some((item) => !(key in item))) {
        required.delete(key)
      }
    }

    return {
      type: 'object',
      properties,
      required: Array.from(required),
    }
  }

  if (kind === 'integer') {
    return { type: 'integer' }
  }

  return { type: kind }
}

function unionKinds(samples: unknown[], kinds: string[]): JsonSchema {
  if (kinds.length === 1) {
    return inferSingleKind(kinds[0], samples)
  }

  if (kinds.every((kind) => kind === 'integer' || kind === 'number')) {
    return { type: 'number' }
  }

  return {
    anyOf: kinds.map((kind) =>
      inferSingleKind(
        kind,
        samples.filter((sample) => kindOf(sample) === kind),
      ),
    ),
  }
}

export function inferSchema(samples: unknown[]): JsonSchema {
  if (samples.length === 0) {
    return { type: 'object' }
  }

  const kinds = Array.from(new Set(samples.map((sample) => kindOf(sample))))

  if (kinds.length > 1) {
    return unionKinds(samples, kinds)
  }

  const kind = kinds[0] ?? 'null'
  return inferSingleKind(kind, samples)
}
