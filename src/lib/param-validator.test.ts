import { describe, expect, it } from 'vitest'
import { validateParams, validateType } from './param-validator.js'
import type { OpenApiParameter } from './spec-loader.js'

describe('validateParams', () => {
  it('applies default values', () => {
    const params: OpenApiParameter[] = [
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
    ]
    const result = validateParams(params, {})
    expect(result.limit).toBe(10)
  })

  it('throws on unknown parameters', () => {
    const params: OpenApiParameter[] = [
      { name: 'q', in: 'query', schema: { type: 'string' } },
    ]
    expect(() => validateParams(params, { q: 'test', unknown: 'bad' })).toThrow('Unknown parameter')
  })

  it('throws on missing required parameter', () => {
    const params: OpenApiParameter[] = [
      { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
    ]
    expect(() => validateParams(params, {})).toThrow('Missing required')
  })
})

describe('RC3: JSON auto-stringify', () => {
  it('auto-stringifies object value for string param with x-openweb-json-schema', () => {
    const params = [
      {
        name: 'variables',
        in: 'query',
        schema: { type: 'string' },
        'x-openweb-json-schema': {
          type: 'object',
          properties: {
            rawQuery: { type: 'string' },
            count: { type: 'integer' },
          },
        },
      } as unknown as OpenApiParameter,
    ]
    const result = validateParams(params, {
      variables: { rawQuery: 'turboquant', count: 20 },
    })
    expect(result.variables).toBe(JSON.stringify({ rawQuery: 'turboquant', count: 20 }))
    expect(typeof result.variables).toBe('string')
  })

  it('does not stringify when x-openweb-json-schema is absent', () => {
    const params: OpenApiParameter[] = [
      { name: 'data', in: 'query', schema: { type: 'object' } },
    ]
    const result = validateParams(params, { data: { key: 'value' } })
    expect(typeof result.data).toBe('object')
  })

  it('does not stringify string values even with x-openweb-json-schema', () => {
    const params = [
      {
        name: 'variables',
        in: 'query',
        schema: { type: 'string' },
        'x-openweb-json-schema': { type: 'object' },
      } as unknown as OpenApiParameter,
    ]
    const result = validateParams(params, { variables: '{"already":"stringified"}' })
    expect(result.variables).toBe('{"already":"stringified"}')
  })
})

describe('validateType', () => {
  it('accepts valid string', () => {
    expect(() => validateType('name', 'hello', { type: 'string' })).not.toThrow()
  })

  it('rejects number for string schema', () => {
    expect(() => validateType('name', 42, { type: 'string' })).toThrow('must be string')
  })

  it('accepts valid integer', () => {
    expect(() => validateType('count', 5, { type: 'integer' })).not.toThrow()
  })

  it('accepts valid boolean', () => {
    expect(() => validateType('flag', true, { type: 'boolean' })).not.toThrow()
  })

  it('accepts null when schema includes null type', () => {
    expect(() => validateType('opt', null, { type: ['string', 'null'] })).not.toThrow()
  })
})
