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
          responseJson: {},
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
          responseJson: {},
        },
      ],
    }

    const params = differentiateParameters(endpoint)

    const latitude = params.find((item) => item.name === 'latitude')
    const hourly = params.find((item) => item.name === 'hourly')
    const daily = params.find((item) => item.name === 'daily')

    expect(latitude?.required).toBe(true)
    expect(latitude?.schema).toEqual({ type: 'number' })

    expect(hourly?.required).toBe(false)
    expect(hourly?.schema).toEqual({
      type: 'array',
      items: { type: 'string' },
    })

    expect(daily?.required).toBe(true)
    expect(daily?.schema).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })
})
