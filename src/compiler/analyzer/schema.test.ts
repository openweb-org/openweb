import { describe, expect, it } from 'vitest'

import { inferSchema } from './schema.js'

describe('inferSchema', () => {
  it('infers nested object schema from multiple samples', () => {
    const schema = inferSchema([
      {
        latitude: 52.52,
        hourly: {
          time: ['2026-01-01T00:00'],
          temperature_2m: [1.2],
        },
      },
      {
        latitude: 35.68,
        hourly: {
          time: ['2026-01-01T00:00'],
          temperature_2m: [2.3],
        },
      },
    ])

    expect(schema.type).toBe('object')
    const properties = schema.properties as Record<string, unknown>
    expect(properties.latitude).toEqual({ type: 'number' })
    expect((properties.hourly as { type?: string }).type).toBe('object')
  })

  it('keeps object structure when value can also be null', () => {
    const schema = inferSchema([
      {
        meta: null,
      },
      {
        meta: {
          source: 'api',
        },
      },
    ])

    const properties = schema.properties as Record<string, { anyOf?: unknown[] }>
    const meta = properties.meta
    expect(meta.anyOf).toBeDefined()
    expect(meta.anyOf?.some((item) => (item as { type?: string }).type === 'null')).toBe(true)
    expect(meta.anyOf?.some((item) => (item as { type?: string }).type === 'object')).toBe(true)
  })
})
