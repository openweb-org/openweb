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
