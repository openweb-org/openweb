import { describe, expect, it } from 'vitest'

import { OpenWebError } from './errors.js'
import { buildQueryUrl } from './openapi.js'

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
