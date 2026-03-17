import { createHash } from 'node:crypto'

const MAX_DEPTH = 3
const MAX_ARRAY_SAMPLE = 3

/**
 * Compute a stable fingerprint of a response body based on its structural shape.
 * Recurses into nested objects up to depth 3, samples first 3 array elements,
 * and includes field counts at each level.
 * Returns a 16-char hex hash (matches existing hash16 pattern).
 */
export function computeResponseFingerprint(body: unknown): string {
  const shape = describeShape(body, 0)
  return createHash('sha256').update(shape).digest('hex').slice(0, 16)
}

function describeShape(value: unknown, depth: number): string {
  if (value === null || value === undefined) return 'null'

  if (Array.isArray(value)) {
    if (value.length === 0) return '[0:empty]'
    const samples = value.slice(0, MAX_ARRAY_SAMPLE)
    const itemShapes = samples.map((item) => describeShape(item, depth + 1))
    // Deduplicate shapes to capture heterogeneity
    const unique = [...new Set(itemShapes)]
    return `[${value.length >= MAX_ARRAY_SAMPLE ? `${MAX_ARRAY_SAMPLE}+` : value.length}:${unique.join('|')}]`
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    if (depth >= MAX_DEPTH) {
      // At max depth, record key count + key names only
      return `{${keys.length}:${keys.join(',')}}`
    }
    const entries = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k]
      return `${k}:${describeShape(v, depth + 1)}`
    })
    return `{${keys.length}:${entries.join(',')}}`
  }

  return typeof value
}
