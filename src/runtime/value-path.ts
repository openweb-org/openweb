/**
 * Set a value at a dotted path within an object, creating intermediate objects as needed.
 * Returns a shallow clone with the value set. Does not mutate the original.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function setValueAtPath(
  input: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return input
  if (segments.some((s) => UNSAFE_SEGMENTS.has(s))) return input

  const root = { ...input }
  let current: Record<string, unknown> = root

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const existing = current[seg]
    const next = (existing && typeof existing === 'object' && !Array.isArray(existing))
      ? { ...(existing as Record<string, unknown>) }
      : {}
    current[seg] = next
    current = next
  }

  current[segments[segments.length - 1]] = value
  return root
}

export function getValueAtPath(input: unknown, path: string): unknown {
  if (!path) {
    return input
  }

  let current = input
  for (const rawSegment of path.split('.')) {
    const segment = rawSegment.trim()
    if (!segment) {
      continue
    }

    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) {
        return undefined
      }
      current = current[index]
      continue
    }

    if (!current || typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}
