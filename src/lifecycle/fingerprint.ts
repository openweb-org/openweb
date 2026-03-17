import { createHash } from 'node:crypto'

/**
 * Compute a stable fingerprint of a response body based on its structural shape.
 * Captures: top-level key names (sorted) + value types.
 * For arrays: includes the type of the first element.
 * Returns a 16-char hex hash (matches existing hash16 pattern).
 */
export function computeResponseFingerprint(body: unknown): string {
  const shape = describeShape(body)
  return createHash('sha256').update(shape).digest('hex').slice(0, 16)
}

function describeShape(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    const first = value[0]
    return `[${first !== undefined ? describeShape(first) : 'empty'}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const entries = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k]
      return `${k}:${typeOf(v)}`
    })
    return `{${entries.join(',')}}`
  }
  return typeOf(value)
}

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
