import { describe, expect, it } from 'vitest'

import { clusterSamples } from './cluster.js'

describe('clusterSamples', () => {
  it('clusters by method, host, and path without key splitting', () => {
    const samples = [
      {
        method: 'GET',
        host: 'api.open-meteo.com',
        path: '/v1/forecast',
        url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52',
        query: { latitude: ['52.52'] },
        status: 200,
        contentType: 'application/json',
        response: { kind: 'json', body: { ok: true } },
      },
      {
        method: 'GET',
        host: 'api.open-meteo.com',
        path: '/v1/forecast',
        url: 'https://api.open-meteo.com/v1/forecast?latitude=35.68',
        query: { latitude: ['35.68'] },
        status: 200,
        contentType: 'application/json',
        response: { kind: 'json', body: { ok: true } },
      },
      {
        method: 'GET',
        host: 'geocoding-api.open-meteo.com',
        path: '/v1/search',
        url: 'https://geocoding-api.open-meteo.com/v1/search?name=Berlin',
        query: { name: ['Berlin'] },
        status: 200,
        contentType: 'application/json',
        response: { kind: 'json', body: { ok: true } },
      },
    ]

    const grouped = clusterSamples(samples)
    expect(grouped).toHaveLength(2)

    const forecast = grouped.find((item) => item.path === '/v1/forecast')
    expect(forecast?.samples).toHaveLength(2)
  })
})
