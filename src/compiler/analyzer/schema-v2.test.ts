import { describe, expect, it } from 'vitest'
import { inferSchema } from './schema-v2.js'

describe('inferSchema (v2)', () => {
  // ---- Basic behavior (parity with v1) ----

  it('infers nested object schema from multiple samples', () => {
    const schema = inferSchema([
      { latitude: 52.52, hourly: { time: ['2026-01-01T00:00'], temperature_2m: [1.2] } },
      { latitude: 35.68, hourly: { time: ['2026-01-01T00:00'], temperature_2m: [2.3] } },
    ])
    expect(schema.type).toBe('object')
    const props = schema.properties as Record<string, { type?: string }>
    expect(props.latitude).toEqual({ type: 'number' })
    expect(props.hourly.type).toBe('object')
  })

  it('keeps object structure when value can also be null', () => {
    const schema = inferSchema([{ meta: null }, { meta: { source: 'api' } }])
    const meta = (schema.properties as Record<string, { anyOf?: { type?: string }[] }>).meta
    expect(meta.anyOf).toBeDefined()
    expect(meta.anyOf?.some((s) => s.type === 'null')).toBe(true)
    expect(meta.anyOf?.some((s) => s.type === 'object')).toBe(true)
  })

  it('returns { type: "object" } for empty input', () => {
    expect(inferSchema([])).toEqual({ type: 'object' })
  })

  it('handles null-only samples', () => {
    expect(inferSchema([null, null])).toEqual({ type: 'null' })
  })

  it('handles boolean samples', () => {
    expect(inferSchema([true, false])).toEqual({ type: 'boolean' })
  })

  it('merges integer and number into number', () => {
    expect(inferSchema([1, 2.5, 3])).toEqual({ type: 'number' })
  })

  it('generates anyOf for mixed types', () => {
    const schema = inferSchema(['hello', 42])
    expect(schema.anyOf).toBeDefined()
    const types = (schema.anyOf as { type?: string }[]).map((s) => s.type)
    expect(types).toContain('string')
    expect(types).toContain('integer')
  })

  // ---- Enum detection (SC-10) ----

  it('detects enum for string field with few distinct values', () => {
    const schema = inferSchema([
      { status: 'draft' },
      { status: 'published' },
      { status: 'archived' },
      { status: 'draft' },
      { status: 'published' },
    ])
    const statusSchema = (schema.properties as Record<string, { type?: string; enum?: string[] }>).status
    expect(statusSchema.type).toBe('string')
    expect(statusSchema.enum).toEqual(['archived', 'draft', 'published'])
  })

  it('skips enum when string field has >10 distinct values', () => {
    const values = Array.from({ length: 15 }, (_, i) => ({ code: `val_${i}` }))
    const schema = inferSchema(values)
    const codeSchema = (schema.properties as Record<string, { type?: string; enum?: unknown }>).code
    expect(codeSchema.type).toBe('string')
    expect(codeSchema.enum).toBeUndefined()
  })

  it('detects enum at exactly 10 distinct values', () => {
    const values = Array.from({ length: 10 }, (_, i) => ({ tag: `t${i}` }))
    const schema = inferSchema(values)
    const tagSchema = (schema.properties as Record<string, { enum?: string[] }>).tag
    expect(tagSchema.enum).toBeDefined()
    expect(tagSchema.enum).toHaveLength(10)
  })

  // ---- Format annotation (SC-11) ----

  it('detects date format', () => {
    const schema = inferSchema([{ d: '2024-01-15' }, { d: '2023-06-30' }])
    const d = (schema.properties as Record<string, { format?: string }>).d
    expect(d.format).toBe('date')
  })

  it('detects date-time format', () => {
    const schema = inferSchema([{ ts: '2024-01-15T08:30:00Z' }, { ts: '2023-06-30T12:00:00Z' }])
    const ts = (schema.properties as Record<string, { format?: string }>).ts
    expect(ts.format).toBe('date-time')
  })

  it('detects uuid format', () => {
    const schema = inferSchema([
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    ])
    const id = (schema.properties as Record<string, { format?: string }>).id
    expect(id.format).toBe('uuid')
  })

  it('detects email format', () => {
    const schema = inferSchema([{ email: 'a@b.com' }, { email: 'user@example.org' }])
    const email = (schema.properties as Record<string, { format?: string }>).email
    expect(email.format).toBe('email')
  })

  it('detects uri format', () => {
    const schema = inferSchema([{ url: 'https://example.com' }, { url: 'http://test.org/path' }])
    const url = (schema.properties as Record<string, { format?: string }>).url
    expect(url.format).toBe('uri')
  })

  it('prefers format over enum when pattern matches', () => {
    // 2 distinct UUIDs — fits enum threshold but format wins
    const schema = inferSchema([
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    ])
    const id = (schema.properties as Record<string, { enum?: string[]; format?: string }>).id
    expect(id.format).toBe('uuid')
    expect(id.enum).toBeUndefined()
  })

  it('falls back to enum when no format matches', () => {
    const schema = inferSchema([
      { role: 'admin' },
      { role: 'editor' },
      { role: 'viewer' },
    ])
    const role = (schema.properties as Record<string, { enum?: string[]; format?: string }>).role
    expect(role.enum).toEqual(['admin', 'editor', 'viewer'])
    expect(role.format).toBeUndefined()
  })

  it('does not annotate format when values are mixed patterns', () => {
    const schema = inferSchema([{ val: '2024-01-15' }, { val: 'not-a-date' }])
    const val = (schema.properties as Record<string, { format?: string }>).val
    expect(val.format).toBeUndefined()
  })

  // ---- Size controls (SC-7, SC-9) ----

  it('truncates at maxDepth', () => {
    // Build 15-level deep object
    let obj: unknown = { leaf: 'value' }
    for (let i = 0; i < 14; i++) obj = { nested: obj }

    const schema = inferSchema([obj], { maxDepth: 5 })

    // Walk down 5 levels — last should be { type: 'object' } with no properties
    let current = schema
    for (let i = 0; i < 5; i++) {
      const props = current.properties as Record<string, { type?: string; properties?: unknown }> | undefined
      if (!props?.nested) break
      current = props.nested as typeof current
    }
    expect(current).toEqual({ type: 'object' })
  })

  it('truncates at maxProperties', () => {
    const obj: Record<string, number> = {}
    for (let i = 0; i < 200; i++) obj[`prop_${String(i).padStart(3, '0')}`] = i

    const schema = inferSchema([obj], { maxProperties: 50 })
    const propCount = Object.keys(schema.properties ?? {}).length
    expect(propCount).toBe(50)
    expect((schema as Record<string, unknown>).additionalProperties).toBe(true)
    expect((schema as Record<string, unknown>)['x-truncated']).toBe(true)
  })

  it('samples array items at maxArraySample', () => {
    // 1000-item array where first 5 are numbers, rest are strings
    // With maxArraySample=5, schema should infer integer (only sees first 5)
    const items = [
      ...Array.from({ length: 5 }, (_, i) => i),
      ...Array.from({ length: 995 }, (_, i) => `str_${i}`),
    ]

    const schema = inferSchema([items], { maxArraySample: 5 })
    expect(schema.type).toBe('array')
    expect((schema.items as { type?: string })?.type).toBe('integer')
  })

  it('uses default options when none provided', () => {
    // Just ensure defaults don't crash on reasonable input
    const schema = inferSchema([{ a: 1, b: 'x', c: [1, 2] }])
    expect(schema.type).toBe('object')
  })

  // ---- Required field tracking ----

  it('tracks required fields correctly', () => {
    const schema = inferSchema([
      { a: 1, b: 2 },
      { a: 3 },
    ])
    expect(schema.required).toContain('a')
    expect(schema.required).not.toContain('b')
  })

  // ---- Nested arrays ----

  it('infers schema for nested arrays of objects', () => {
    const schema = inferSchema([
      { items: [{ name: 'Alice' }, { name: 'Bob' }] },
      { items: [{ name: 'Charlie' }] },
    ])
    const items = (schema.properties as Record<string, { type?: string; items?: { type?: string } }>).items
    expect(items.type).toBe('array')
    expect(items.items?.type).toBe('object')
  })
})
