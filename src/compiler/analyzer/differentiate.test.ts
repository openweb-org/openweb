import { describe, expect, it } from 'vitest'

import { differentiateParameters } from './differentiate.js'

describe('differentiateParameters', () => {
  it('detects required and optional params with array types', () => {
    const endpoint = {
      method: 'GET',
      host: 'api.open-meteo.com',
      path: '/v1/forecast',
      samples: [
        {
          method: 'GET',
          host: 'api.open-meteo.com',
          path: '/v1/forecast',
          url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52&hourly=temperature_2m&hourly=precipitation',
          query: {
            latitude: ['52.52'],
            hourly: ['temperature_2m', 'precipitation'],
            daily: ['temperature_2m_max'],
          },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json', body: {} },
        },
        {
          method: 'GET',
          host: 'api.open-meteo.com',
          path: '/v1/forecast',
          url: 'https://api.open-meteo.com/v1/forecast?latitude=35.68',
          query: {
            latitude: ['35.68'],
            daily: ['temperature_2m_min'],
          },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json', body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)

    const latitude = params.find((item) => item.name === 'latitude')
    const hourly = params.find((item) => item.name === 'hourly')
    const daily = params.find((item) => item.name === 'daily')

    expect(latitude?.required).toBe(true)
    expect(latitude?.location).toBe('query')
    expect(latitude?.schema).toEqual({ type: 'number' })

    // hourly has multiple values in one sample → detected as array
    expect(hourly?.required).toBe(false)
    expect(hourly?.schema).toEqual({
      type: 'array',
      items: { type: 'string' },
    })

    // daily has only single values per sample → detected as string (no hardcoded override)
    expect(daily?.required).toBe(true)
    expect(daily?.schema).toEqual({ type: 'string' })
  })

  it('treats tuple-like values as scalar string, not array', () => {
    const endpoint = {
      method: 'GET',
      host: 'api.example.com',
      path: '/search',
      samples: [
        {
          method: 'GET',
          host: 'api.example.com',
          path: '/search',
          url: 'https://api.example.com/search?filter=(type:job,status:active)',
          query: { filter: ['(type:job,status:active)'] },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json' as const, body: {} },
        },
        {
          method: 'GET',
          host: 'api.example.com',
          path: '/search',
          url: 'https://api.example.com/search?filter=(type:user,role:admin)',
          query: { filter: ['(type:user,role:admin)'] },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json' as const, body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)
    const filter = params.find((p) => p.name === 'filter')

    // Should be string, not array — commas inside parens are structural
    expect(filter?.schema).toEqual({ type: 'string' })
  })

  it('treats JSON-like values as scalar string, not array', () => {
    const endpoint = {
      method: 'GET',
      host: 'api.example.com',
      path: '/query',
      samples: [
        {
          method: 'GET',
          host: 'api.example.com',
          path: '/query',
          url: 'https://api.example.com/query?q={"a":1,"b":2}',
          query: { q: ['{"a":1,"b":2}'] },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json' as const, body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)
    const q = params.find((p) => p.name === 'q')

    expect(q?.schema).toEqual({ type: 'string' })
  })

  it('treats bracket-wrapped values as scalar string, not array', () => {
    const endpoint = {
      method: 'GET',
      host: 'api.example.com',
      path: '/data',
      samples: [
        {
          method: 'GET',
          host: 'api.example.com',
          path: '/data',
          url: 'https://api.example.com/data?ids=[1,2,3]',
          query: { ids: ['[1,2,3]'] },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json' as const, body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)
    const ids = params.find((p) => p.name === 'ids')

    // Even though it contains commas, the brackets signal a structured value
    expect(ids?.schema).toEqual({ type: 'string' })
  })

  it('still splits plain comma-separated values as array', () => {
    const endpoint = {
      method: 'GET',
      host: 'api.example.com',
      path: '/items',
      samples: [
        {
          method: 'GET',
          host: 'api.example.com',
          path: '/items',
          url: 'https://api.example.com/items?tags=red,blue',
          query: { tags: ['red,blue'] },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json' as const, body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)
    const tags = params.find((p) => p.name === 'tags')

    // Plain comma-separated should still be treated as array
    expect(tags?.schema).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('infers integer type when all numeric values are integers', () => {
    const endpoint = {
      method: 'GET',
      host: 'geocoding-api.open-meteo.com',
      path: '/v1/search',
      samples: [
        {
          method: 'GET',
          host: 'geocoding-api.open-meteo.com',
          path: '/v1/search',
          url: 'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=1',
          query: {
            name: ['Berlin'],
            count: ['1'],
          },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json', body: {} },
        },
        {
          method: 'GET',
          host: 'geocoding-api.open-meteo.com',
          path: '/v1/search',
          url: 'https://geocoding-api.open-meteo.com/v1/search?name=Tokyo&count=5',
          query: {
            name: ['Tokyo'],
            count: ['5'],
          },
          status: 200,
          contentType: 'application/json',
          response: { kind: 'json', body: {} },
        },
      ],
    }

    const params = differentiateParameters(endpoint)
    const count = params.find((item) => item.name === 'count')
    expect(count?.schema).toEqual({ type: 'integer' })
  })
})
