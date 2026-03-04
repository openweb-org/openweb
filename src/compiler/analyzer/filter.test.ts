import { describe, expect, it } from 'vitest'

import { filterSamples } from './filter.js'

describe('filterSamples', () => {
  it('keeps only GET 2xx json entries on allowed hosts', () => {
    const input = [
      {
        method: 'GET',
        host: 'api.open-meteo.com',
        path: '/v1/forecast',
        url: 'https://api.open-meteo.com/v1/forecast',
        query: {},
        status: 200,
        contentType: 'application/json',
        responseJson: {},
      },
      {
        method: 'POST',
        host: 'api.open-meteo.com',
        path: '/v1/forecast',
        url: 'https://api.open-meteo.com/v1/forecast',
        query: {},
        status: 200,
        contentType: 'application/json',
        responseJson: {},
      },
      {
        method: 'GET',
        host: 'example.com',
        path: '/api',
        url: 'https://example.com/api',
        query: {},
        status: 200,
        contentType: 'application/json',
        responseJson: {},
      },
    ]

    const output = filterSamples(input)
    expect(output).toHaveLength(1)
    expect(output[0].host).toBe('api.open-meteo.com')
  })
})
