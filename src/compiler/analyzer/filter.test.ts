import { describe, expect, it } from 'vitest'

import { filterSamples } from './filter.js'
import type { RecordedRequestSample } from '../types.js'

function makeSample(overrides: Partial<RecordedRequestSample> = {}): RecordedRequestSample {
  return {
    method: 'GET',
    host: 'api.example.com',
    path: '/v1/data',
    url: 'https://api.example.com/v1/data',
    query: {},
    status: 200,
    contentType: 'application/json',
    responseJson: { ok: true },
    ...overrides,
  }
}

describe('filterSamples', () => {
  it('keeps only GET 2xx json entries on allowed hosts (legacy compat)', () => {
    const input = [
      makeSample({ host: 'api.open-meteo.com', path: '/v1/forecast', url: 'https://api.open-meteo.com/v1/forecast' }),
      makeSample({
        method: 'POST',
        host: 'api.open-meteo.com',
        path: '/v1/forecast',
        url: 'https://api.open-meteo.com/v1/forecast',
      }),
      makeSample({ host: 'example.com', path: '/api', url: 'https://example.com/api' }),
    ]

    const output = filterSamples(input, { targetUrl: 'https://open-meteo.com', allowMutations: false })
    expect(output).toHaveLength(1)
    expect(output[0].host).toBe('api.open-meteo.com')
  })

  it('allows subdomains of target domain', () => {
    const input = [
      makeSample({ host: 'api.notion.so' }),
      makeSample({ host: 'www.notion.so' }),
      makeSample({ host: 'notion.so' }),
      makeSample({ host: 'unrelated.com' }),
    ]

    const output = filterSamples(input, { targetUrl: 'https://www.notion.so' })
    expect(output).toHaveLength(3)
    expect(output.map((s) => s.host)).toEqual(['api.notion.so', 'www.notion.so', 'notion.so'])
  })

  it('blocks analytics/tracking domains', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'connect.facebook.net' }),
      makeSample({ host: 'cdn.segment.io' }),
      makeSample({ host: 'js.sentry.io' }),
    ]

    const output = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(output).toHaveLength(1)
    expect(output[0].host).toBe('api.example.com')
  })

  it('allows mutations by default', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'DELETE' }),
    ]

    const output = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(output).toHaveLength(3)
  })

  it('rejects mutations when allowMutations is false', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'PUT' }),
    ]

    const output = filterSamples(input, { targetUrl: 'https://example.com', allowMutations: false })
    expect(output).toHaveLength(1)
  })

  it('rejects non-2xx responses', () => {
    const input = [
      makeSample({ status: 200 }),
      makeSample({ status: 301 }),
      makeSample({ status: 404 }),
      makeSample({ status: 500 }),
    ]

    const output = filterSamples(input)
    expect(output).toHaveLength(1)
  })

  it('rejects non-JSON content types', () => {
    const input = [
      makeSample({ contentType: 'application/json' }),
      makeSample({ contentType: 'text/html' }),
      makeSample({ contentType: 'image/png' }),
    ]

    const output = filterSamples(input)
    expect(output).toHaveLength(1)
  })

  it('allows all hosts when no targetUrl specified (minus blocklist)', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'other.site.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
    ]

    const output = filterSamples(input)
    expect(output).toHaveLength(2)
  })

  it('supports explicit allowHosts', () => {
    const input = [
      makeSample({ host: 'custom-api.io' }),
      makeSample({ host: 'api.example.com' }),
    ]

    const output = filterSamples(input, { allowHosts: ['custom-api.io'] })
    expect(output).toHaveLength(1)
    expect(output[0].host).toBe('custom-api.io')
  })

  it('blocks infrastructure/noise paths', () => {
    const input = [
      makeSample({ path: '/api/v1/users' }),
      makeSample({ path: '/manifest.json' }),
      makeSample({ path: '/_next/data/abc/page.json' }),
      makeSample({ path: '/api/v1/trace' }),
      makeSample({ path: '/telemetry' }),
      makeSample({ path: '/.well-known/openid-configuration' }),
      makeSample({ path: '/api/v1/tracking' }),
    ]

    const output = filterSamples(input)
    expect(output).toHaveLength(1)
    expect(output[0].path).toBe('/api/v1/users')
  })
})
