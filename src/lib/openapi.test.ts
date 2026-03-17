import { describe, expect, it } from 'vitest'

import { OpenWebError } from './errors.js'
import { buildQueryUrl, findOperation, getRequestBodyParameters, loadOpenApi, validateParams } from './openapi.js'

describe('buildQueryUrl', () => {
  it('builds query string for scalar and array params', () => {
    const url = buildQueryUrl(
      'https://api.example.com',
      '/v1/forecast',
      [
        { name: 'latitude', in: 'query', required: true, schema: { type: 'number' } },
        { name: 'hourly', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } },
      ],
      {
        latitude: 52.52,
        hourly: ['temperature_2m', 'precipitation'],
      },
    )

    expect(url).toContain('https://api.example.com/v1/forecast?')
    expect(url).toContain('latitude=52.52')
    expect(url).toContain('hourly=temperature_2m')
    expect(url).toContain('hourly=precipitation')
  })

  it('throws INVALID_PARAMS for missing required parameter', () => {
    expect(() =>
      buildQueryUrl(
        'https://api.example.com',
        '/v1/forecast',
        [{ name: 'latitude', in: 'query', required: true, schema: { type: 'number' } }],
        {},
      ),
    ).toThrowError(OpenWebError)
  })

  it('throws INVALID_PARAMS for unknown input parameter', () => {
    expect(() =>
      buildQueryUrl(
        'https://api.example.com',
        '/v1/forecast',
        [{ name: 'latitude', in: 'query', required: true, schema: { type: 'number' } }],
        { latitude: 52.52, lat: 52.52 },
      ),
    ).toThrowError(OpenWebError)
  })
})

describe('getRequestBodyParameters', () => {
  it('reads required request body fields from fixture schemas', async () => {
    const spec = await loadOpenApi('reddit-fixture')
    const operation = findOperation(spec, 'vote').operation

    const params = getRequestBodyParameters(operation)

    expect(params.find((param) => param.name === 'id')?.required).toBe(true)
    expect(params.find((param) => param.name === 'dir')?.required).toBe(true)
  })
})

describe('validateParams', () => {
  it('rejects non-object values for object body parameters', () => {
    expect(() =>
      validateParams(
        [
          {
            name: 'context',
            in: 'body',
            schema: {
              type: 'object',
              properties: {
                client: { type: 'string' },
              },
            },
          },
        ],
        { context: 'oops' },
      ),
    ).toThrow('Parameter context must be object')
  })

  it('accepts union schemas that allow either array or object', () => {
    expect(
      validateParams(
        [
          {
            name: 'payload',
            in: 'body',
            schema: {
              type: ['array', 'object'],
            },
          },
        ],
        { payload: { ok: true } },
      ),
    ).toEqual({ payload: { ok: true } })
  })
})
