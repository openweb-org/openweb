import type { ParameterDescriptor, RecordedRequestSample } from '../types.js'

/**
 * Standard/browser-managed headers to ignore when detecting constant non-standard headers.
 * These are set by the browser or HTTP stack, not by application code.
 */
const STANDARD_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'dnt',
  'host',
  'origin',
  'pragma',
  'referer',
  'te',
  'upgrade-insecure-requests',
  'user-agent',
])

/** Prefixes for browser-managed headers that should always be skipped */
function isAutoHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('sec-') || lower.startsWith(':')
}

/**
 * Detect non-standard headers that appear in EVERY sample with exactly ONE stable value.
 * Returns ParameterDescriptors with location='header', required=true, and const enum schema.
 */
export function detectConstantHeaders(samples: RecordedRequestSample[]): ParameterDescriptor[] {
  if (samples.length < 2) return []

  // Collect header values across all samples: name → Set<value>
  const headerValues = new Map<string, Set<string>>()
  const headerPresence = new Map<string, number>()
  // Track original casing from first occurrence
  const headerCasing = new Map<string, string>()

  for (const sample of samples) {
    if (!sample.requestHeaders) return []
    for (const h of sample.requestHeaders) {
      const lower = h.name.toLowerCase()
      if (STANDARD_HEADERS.has(lower)) continue
      if (isAutoHeader(h.name)) continue

      if (!headerCasing.has(lower)) headerCasing.set(lower, h.name)

      const values = headerValues.get(lower)
      if (values) {
        values.add(h.value)
      } else {
        headerValues.set(lower, new Set([h.value]))
      }
      headerPresence.set(lower, (headerPresence.get(lower) ?? 0) + 1)
    }
  }

  const result: ParameterDescriptor[] = []
  for (const [lower, values] of headerValues) {
    // Must be present in every sample and have exactly one value
    if (headerPresence.get(lower) !== samples.length) continue
    if (values.size !== 1) continue

    const constValue = [...values][0]
    const originalName = headerCasing.get(lower) ?? lower

    result.push({
      name: originalName,
      location: 'header',
      required: true,
      schema: { type: 'string', enum: [constValue] },
      exampleValue: constValue,
    })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}
