import { describe, expect, it } from 'vitest'

import type { RecordedRequestSample } from '../types.js'
import { filterSamples } from './filter.js'
import type { FilterLabel, LabeledSample } from './filter.js'

function makeSample(overrides: Partial<RecordedRequestSample> = {}): RecordedRequestSample {
  return {
    method: 'GET',
    host: 'api.example.com',
    path: '/v1/data',
    url: 'https://api.example.com/v1/data',
    query: {},
    status: 200,
    contentType: 'application/json',
    response: { kind: 'json', body: { ok: true } },
    ...overrides,
  }
}

/** Extract samples with a specific label from the labeled array. */
function withLabel(labeled: LabeledSample[], label: FilterLabel): RecordedRequestSample[] {
  return labeled.filter((ls) => ls.label === label).map((ls) => ls.sample)
}

describe('filterSamples', () => {
  it('keeps only GET entries on allowed hosts when mutations disabled', () => {
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

    const { labeled } = filterSamples(input, { targetUrl: 'https://open-meteo.com', allowMutations: false })
    const kept = withLabel(labeled, 'kept')
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

    const { labeled } = filterSamples(input, { targetUrl: 'https://www.notion.so' })
    const kept = withLabel(labeled, 'kept')
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

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com' })
    const kept = withLabel(labeled, 'kept')
    const blockedHost = withLabel(labeled, 'blocked_host')
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('api.example.com')
    expect(blockedHost).toHaveLength(4)
  })

  it('allows mutations by default', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'DELETE' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com' })
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(3)
  })

  it('rejects mutations when allowMutations is false', () => {
    const input = [
      makeSample({ method: 'GET' }),
      makeSample({ method: 'POST' }),
      makeSample({ method: 'PUT' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com', allowMutations: false })
    const kept = withLabel(labeled, 'kept')
    const mutationGated = withLabel(labeled, 'mutation_gated')
    expect(kept).toHaveLength(1)
    expect(mutationGated).toHaveLength(2)
  })

  it('passes all status codes through (non-2xx are not filtered)', () => {
    const input = [
      makeSample({ status: 200 }),
      makeSample({ status: 301 }),
      makeSample({ status: 404 }),
      makeSample({ status: 500 }),
    ]

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(4)
    expect(labeled.every((ls) => ls.label === 'kept')).toBe(true)
  })

  it('passes 4xx status codes through (auth/rate-limit signals)', () => {
    const input = [
      makeSample({ status: 401 }),
      makeSample({ status: 403 }),
      makeSample({ status: 429 }),
    ]

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(3)
  })

  it('keeps all JSON-parseable content types (filtering delegated to recorder)', () => {
    const input = [
      makeSample({ contentType: 'application/json' }),
      makeSample({ contentType: 'text/html' }),
      makeSample({ contentType: 'application/vnd.linkedin.normalized+json+2.1; charset=utf-8' }),
      makeSample({ contentType: 'application/graphql; charset=utf-8' }),
    ]

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(4)
  })

  it('allows all hosts when no targetUrl specified (minus blocklist)', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'other.site.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
    ]

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(2)
  })

  it('supports explicit allowHosts', () => {
    const input = [
      makeSample({ host: 'custom-api.io' }),
      makeSample({ host: 'api.example.com' }),
    ]

    const { labeled } = filterSamples(input, { allowHosts: ['custom-api.io'] })
    const kept = withLabel(labeled, 'kept')
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

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
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

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(7) // all should pass
  })

  it('handles multi-part TLDs correctly', () => {
    const input = [
      makeSample({ host: 'api.bbc.co.uk' }),
      makeSample({ host: 'www.bbc.co.uk' }),
      makeSample({ host: 'bbc.co.uk' }),
      makeSample({ host: 'unrelated.co.uk' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://www.bbc.co.uk' })
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(3)
    expect(kept.map((s) => s.host)).toEqual(['api.bbc.co.uk', 'www.bbc.co.uk', 'bbc.co.uk'])
  })

  it('isolates hosting platform subdomains (github.io, netlify.app, etc.)', () => {
    const input = [
      makeSample({ host: 'mysite.github.io' }),
      makeSample({ host: 'othersite.github.io' }),
      makeSample({ host: 'github.io' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://mysite.github.io' })
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('mysite.github.io')
  })

  it('does not block .well-known with unescaped dot', () => {
    const input = [
      makeSample({ path: '/xwell-known/something' }),  // should NOT be blocked
      makeSample({ path: '/.well-known/openid' }),      // should be blocked
    ]

    const { labeled } = filterSamples(input)
    const kept = withLabel(labeled, 'kept')
    expect(kept).toHaveLength(1)
    expect(kept[0].path).toBe('/xwell-known/something')
  })

  it('labels samples with correct filter labels', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ status: 404 }),
      makeSample({ path: '/manifest.json' }),
      makeSample({ host: 'off-domain.com' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com' })
    const kept = withLabel(labeled, 'kept')
    const blockedHost = withLabel(labeled, 'blocked_host')
    const blockedPath = withLabel(labeled, 'blocked_path')
    const offDomain = withLabel(labeled, 'off_domain')

    expect(kept).toHaveLength(2) // api.example.com (200) + api.example.com (404)
    expect(blockedHost).toHaveLength(1)
    expect(blockedPath).toHaveLength(1)
    expect(offDomain).toHaveLength(1)
    expect(offDomain[0].host).toBe('off-domain.com')
  })

  it('labels off-domain samples separately from kept and blocked', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'cdn.other.com' }),
      makeSample({ host: 'api.third-party.io' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com' })
    const kept = withLabel(labeled, 'kept')
    const offDomain = withLabel(labeled, 'off_domain')

    expect(kept).toHaveLength(1)
    expect(kept[0].host).toBe('api.example.com')
    expect(offDomain).toHaveLength(2)
    expect(offDomain.map((s) => s.host)).toEqual(['cdn.other.com', 'api.third-party.io'])
  })

  it('preserves all samples in labeled array (nothing dropped)', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'off-domain.com' }),
      makeSample({ path: '/manifest.json' }),
    ]

    const { labeled } = filterSamples(input, { targetUrl: 'https://example.com' })
    expect(labeled).toHaveLength(input.length)
  })
})
