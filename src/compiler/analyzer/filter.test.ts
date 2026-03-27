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

    const { kept } = filterSamples(input, { targetUrl: 'https://open-meteo.com', allowMutations: false })
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('api.open-meteo.com')
  })

  it('allows subdomains of target domain', () => {
    const input = [
      makeSample({ host: 'api.notion.so' }),
      makeSample({ host: 'www.notion.so' }),
      makeSample({ host: 'notion.so' }),
      makeSample({ host: 'unrelated.com' }),
    ]

    const { kept } = filterSamples(input, { targetUrl: 'https://www.notion.so' })
    expect(kept).toHaveLength(3)
    expect(kept.map((s) => s.host)).toEqual(['api.notion.so', 'www.notion.so', 'notion.so'])
  })

  it('blocks analytics/tracking domains', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'connect.facebook.net' }),
      makeSample({ host: 'cdn.segment.io' }),
      makeSample({ host: 'js.sentry.io' }),
    ]

    const { kept, rejected } = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('api.example.com')
    expect(rejected).toHaveLength(4)
    expect(rejected.every((r) => r.reason === 'blocked_host')).toBe(true)
  })

  it('allows mutations by default', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'DELETE' }),
    ]

    const { kept } = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(kept).toHaveLength(3)
  })

  it('rejects mutations when allowMutations is false', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'PUT' }),
    ]

    const { kept, rejected } = filterSamples(input, { targetUrl: 'https://example.com', allowMutations: false })
    expect(kept).toHaveLength(1)
    expect(rejected).toHaveLength(2)
    expect(rejected.every((r) => r.reason === 'mutation_gated')).toBe(true)
  })

  it('rejects non-2xx responses', () => {
    const input = [
      makeSample({ status: 200 }),
      makeSample({ status: 301 }),
      makeSample({ status: 404 }),
      makeSample({ status: 500 }),
    ]

    const { kept, rejected } = filterSamples(input)
    expect(kept).toHaveLength(1)
    expect(rejected).toHaveLength(3)
    expect(rejected.every((r) => r.reason === 'non_2xx')).toBe(true)
  })

  it('keeps all JSON-parseable content types (filtering delegated to recorder)', () => {
    const input = [
      makeSample({ contentType: 'application/json' }),
      makeSample({ contentType: 'text/html' }),
      makeSample({ contentType: 'application/vnd.linkedin.normalized+json+2.1; charset=utf-8' }),
      makeSample({ contentType: 'application/graphql; charset=utf-8' }),
    ]

    const { kept } = filterSamples(input)
    expect(kept).toHaveLength(4)
  })

  it('allows all hosts when no targetUrl specified (minus blocklist)', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'other.site.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
    ]

    const { kept } = filterSamples(input)
    expect(kept).toHaveLength(2)
  })

  it('supports explicit allowHosts', () => {
    const input = [
      makeSample({ host: 'custom-api.io' }),
      makeSample({ host: 'api.example.com' }),
    ]

    const { kept } = filterSamples(input, { allowHosts: ['custom-api.io'] })
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('custom-api.io')
  })

  it('blocks infrastructure/noise paths', () => {
    const input = [
      makeSample({ path: '/api/v1/users' }),
      makeSample({ path: '/manifest.json' }),
      makeSample({ path: '/_next/data/abc/page.json' }),
      makeSample({ path: '/api/v1/trace' }),
      makeSample({ path: '/_/telemetry' }),
      makeSample({ path: '/.well-known/openid-configuration' }),
      makeSample({ path: '/_/tracking' }),
    ]

    const { kept } = filterSamples(input)
    expect(kept).toHaveLength(1)
    expect(kept[0].path).toBe('/api/v1/users')
  })

  it('does not false-positive on real API paths with similar words', () => {
    const input = [
      makeSample({ path: '/api/v1/tracking/shipments' }),     // real: shipment tracking
      makeSample({ path: '/api/v1/metrics/revenue' }),         // real: business metrics
      makeSample({ path: '/api/v1/logs/audit' }),              // real: audit logs
      makeSample({ path: '/api/v1/experiments/list' }),        // real: A/B test management
      makeSample({ path: '/api/v1/analytics/reports' }),       // real: analytics product
      makeSample({ path: '/api/v1/consent/preferences' }),     // real: consent management
      makeSample({ path: '/api/v1/pixel/campaigns' }),         // real: marketing pixel mgmt
    ]

    const { kept } = filterSamples(input)
    expect(kept).toHaveLength(7) // all should pass
  })

  it('handles multi-part TLDs correctly', () => {
    const input = [
      makeSample({ host: 'api.bbc.co.uk' }),
      makeSample({ host: 'www.bbc.co.uk' }),
      makeSample({ host: 'bbc.co.uk' }),
      makeSample({ host: 'unrelated.co.uk' }),
    ]

    const { kept } = filterSamples(input, { targetUrl: 'https://www.bbc.co.uk' })
    expect(kept).toHaveLength(3)
    expect(kept.map((s) => s.host)).toEqual(['api.bbc.co.uk', 'www.bbc.co.uk', 'bbc.co.uk'])
  })

  it('isolates hosting platform subdomains (github.io, netlify.app, etc.)', () => {
    const input = [
      makeSample({ host: 'mysite.github.io' }),
      makeSample({ host: 'othersite.github.io' }),
      makeSample({ host: 'github.io' }),
    ]

    const { kept } = filterSamples(input, { targetUrl: 'https://mysite.github.io' })
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('mysite.github.io')
  })

  it('does not block .well-known with unescaped dot', () => {
    const input = [
      makeSample({ path: '/xwell-known/something' }),  // should NOT be blocked
      makeSample({ path: '/.well-known/openid' }),      // should be blocked
    ]

    const { kept } = filterSamples(input)
    expect(kept).toHaveLength(1)
    expect(kept[0].path).toBe('/xwell-known/something')
  })

  it('returns rejected samples with correct reasons', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ status: 404 }),
      makeSample({ path: '/manifest.json' }),
      makeSample({ host: 'off-domain.com' }),
    ]

    const { kept, rejected } = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(kept).toHaveLength(1)
    expect(rejected).toHaveLength(4)

    const reasons = rejected.map((r) => r.reason)
    expect(reasons).toContain('blocked_host')
    expect(reasons).toContain('non_2xx')
    expect(reasons).toContain('blocked_path')
    expect(reasons).toContain('off_domain')
  })
})
