/**
 * Tiered example value selection.
 *
 * Priority: schema-derived (enum, format, type) -> most frequent observed -> fallback.
 * Runs PII scrub on the result.
 */

import type { JsonSchema } from '../../lib/openapi.js'
import { scrubRequestBody } from '../curation/scrub.js'

const FORMAT_EXAMPLES: Record<string, unknown> = {
  uuid: '00000000-0000-0000-0000-000000000000',
  email: 'user@example.com',
  'date-time': '2024-01-01T00:00:00Z',
  date: '2024-01-01',
  uri: 'https://example.com',
  url: 'https://example.com',
}

/** Select a representative, PII-safe example value from schema + observed values. */
export function selectExample(schema: JsonSchema, observedValues: unknown[]): unknown {
  // 1. Schema-derived if possible
  const enumValues = schema.enum as unknown[] | undefined
  if (enumValues?.length) return enumValues[0]

  const format = schema.format as string | undefined
  if (format && FORMAT_EXAMPLES[format] !== undefined) return FORMAT_EXAMPLES[format]

  const schemaType = typeof schema.type === 'string' ? schema.type : undefined
  if (schemaType === 'integer') return 1
  if (schemaType === 'number') return 1.0
  if (schemaType === 'boolean') return true

  // 2. Most frequent observed value (scrubbed)
  if (observedValues.length > 0) {
    const freq = new Map<string, { count: number; value: unknown }>()
    for (const v of observedValues) {
      const key = JSON.stringify(v)
      const entry = freq.get(key)
      if (entry) entry.count++
      else freq.set(key, { count: 1, value: v })
    }
    const best = [...freq.values()].sort((a, b) => b.count - a.count)[0]
    if (best) return scrubRequestBody(best.value)
  }

  // 3. Fallback
  return 'example'
}
