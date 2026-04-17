/**
 * Apollo Client cache stores linked entities as `{ __ref: "TypeName:id" }` pointers
 * that resolve to sibling entries (e.g., `state["Book:123"]`). Deep-walk an
 * extracted value, replacing each pointer with its target from the cache —
 * recursively, with cycle detection.
 */
const MAX_DEPTH = 32

function isRef(value: unknown): value is { __ref: string } {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { __ref?: unknown }).__ref === 'string'
}

export function resolveApolloRefs(
  value: unknown,
  cache: Record<string, unknown>,
): unknown {
  const seen = new Set<string>()
  return walk(value, cache, seen, 0)
}

function walk(
  value: unknown,
  cache: Record<string, unknown>,
  seen: Set<string>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value
  }

  if (isRef(value)) {
    const key = value.__ref
    if (seen.has(key)) return { __ref: key }
    const target = cache[key]
    if (target === undefined) return value
    const next = new Set(seen)
    next.add(key)
    return walk(target, cache, next, depth + 1)
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, cache, seen, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v, cache, seen, depth + 1)
  }
  return out
}
