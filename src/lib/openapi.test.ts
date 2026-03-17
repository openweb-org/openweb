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

  it('ignores extra input params not in query/path/header (body params handled separately)', () => {
    const url = buildQueryUrl(
      'https://api.example.com',
      '/v1/forecast',
      [{ name: 'latitude', in: 'query', required: true, schema: { type: 'number' } }],
      { latitude: 52.52, lat: 52.52 },
    )
    expect(url).toContain('latitude=52.52')
    expect(url).not.toContain('lat=')
  })

  it('applies query defaults when the caller omits an optional parameter', () => {
    const url = buildQueryUrl(
      'https://api.example.com',
      '/v1/issues',
      [
        { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
      ],
      {},
    )

    expect(url).toBe('https://api.example.com/v1/issues?page=1')
  })

  it('allows known non-query parameters without treating them as unknown', () => {
    const url = buildQueryUrl(
      'https://api.example.com',
      '/repos/openweb/openweb/issues',
      [
        { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      {
        owner: 'openweb',
        repo: 'openweb',
        'If-None-Match': 'etag-123',
        page: 2,
      },
    )

    expect(url).toBe('https://api.example.com/repos/openweb/openweb/issues?page=2')
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

  it('enforces const value when caller omits the parameter', () => {
    const result = validateParams(
      [
        {
          name: 'query',
          in: 'body',
          required: true,
          schema: { type: 'string', const: 'SELECT * FROM Entity' },
        },
      ],
      {},
    )
    expect(result.query).toBe('SELECT * FROM Entity')
  })

  it('allows caller to pass the exact const value', () => {
    const result = validateParams(
      [
        {
          name: 'query',
          in: 'body',
          required: true,
          schema: { type: 'string', const: 'SELECT * FROM Entity' },
        },
      ],
      { query: 'SELECT * FROM Entity' },
    )
    expect(result.query).toBe('SELECT * FROM Entity')
  })

  it('throws when caller tries to override a const field', () => {
    expect(() =>
      validateParams(
        [
          {
            name: 'query',
            in: 'body',
            required: true,
            schema: { type: 'string', const: 'SELECT * FROM Entity' },
          },
        ],
        { query: 'DROP TABLE users' },
      ),
    ).toThrow('Parameter query is fixed and cannot be overridden')
  })
})
