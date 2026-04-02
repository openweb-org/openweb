import { describe, expect, it } from 'vitest'

import type { SampleCategory } from '../types-v2.js'
import type { RecordedRequestSample } from '../types.js'
import { labelSamples } from './labeler.js'

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

function byCategory(
  labeled: ReturnType<typeof labelSamples>,
  category: SampleCategory,
) {
  return labeled.filter((ls) => ls.category === category)
}

describe('labelSamples', () => {
  const TARGET = 'https://example.com'

  // -----------------------------------------------------------------------
  // Rule 1: blocked domains → tracking
  // -----------------------------------------------------------------------
  it('labels blocked tracking domains as tracking', () => {
    const input = [
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'connect.facebook.net' }),
      makeSample({ host: 'cdn.segment.io' }),
      makeSample({ host: 'js.sentry.io' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'tracking')).toHaveLength(4)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('blocked-domains')
    }
  })

  // -----------------------------------------------------------------------
  // Rule 2: off-domain → off_domain
  // -----------------------------------------------------------------------
  it('labels off-domain hosts as off_domain', () => {
    const input = [
      makeSample({ host: 'cdn.other.com' }),
      makeSample({ host: 'api.third-party.io' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'off_domain')).toHaveLength(2)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('not within target domain')
    }
  })

  it('allows subdomains of target domain as api', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.example.com' }),
      makeSample({ host: 'example.com' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'api')).toHaveLength(3)
  })

  it('handles multi-part TLDs correctly', () => {
    const input = [
      makeSample({ host: 'api.bbc.co.uk' }),
      makeSample({ host: 'www.bbc.co.uk' }),
      makeSample({ host: 'unrelated.co.uk' }),
    ]

    const result = labelSamples(input, 'https://www.bbc.co.uk')
    expect(byCategory(result, 'api')).toHaveLength(2)
    expect(byCategory(result, 'off_domain')).toHaveLength(1)
    expect(byCategory(result, 'off_domain')[0].sample.host).toBe('unrelated.co.uk')
  })

  it('isolates hosting platform subdomains', () => {
    const input = [
      makeSample({ host: 'mysite.github.io' }),
      makeSample({ host: 'othersite.github.io' }),
    ]

    const result = labelSamples(input, 'https://mysite.github.io')
    expect(byCategory(result, 'api')).toHaveLength(1)
    expect(byCategory(result, 'off_domain')).toHaveLength(1)
  })

  // -----------------------------------------------------------------------
  // Rule 3: blocked paths → tracking
  // -----------------------------------------------------------------------
  it('labels blocked infra/noise paths as tracking', () => {
    const input = [
      makeSample({ path: '/manifest.json' }),
      makeSample({ path: '/_next/data/abc/page.json' }),
      makeSample({ path: '/_/telemetry' }),
      makeSample({ path: '/.well-known/openid-configuration' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'tracking')).toHaveLength(4)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('blocked-paths')
    }
  })

  it('labels LinkedIn-style tracking endpoints as tracking', () => {
    const input = [
      makeSample({ path: '/collect/' }),
      makeSample({ path: '/rest/trackObserveApi/trackObserve' }),
      makeSample({ path: '/litms/api/events/ext-tag-load' }),
      makeSample({ path: '/litms/api/events/tms-load' }),
      makeSample({ path: '/security/csp' }),
      makeSample({ path: '/li/tscp/sct' }),
      makeSample({ path: '/px/li_sync' }),
      makeSample({ path: '/realtime/realtimeFrontendClientConnectivityTracking' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'tracking')).toHaveLength(8)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('blocked-paths')
    }
  })

  it('labels telemetry noise paths as tracking', () => {
    const input = [
      makeSample({ path: '/stats/qoe' }),
      makeSample({ path: '/log_event' }),
      makeSample({ path: '/verify_session' }),
      makeSample({ path: '/youtubei/v1/log_event' }),
      makeSample({ path: '/collector' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'tracking')).toHaveLength(5)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('blocked-paths')
    }
  })

  // -----------------------------------------------------------------------
  // Rule 4: static content-type → static
  // -----------------------------------------------------------------------
  it('labels static content-types as static', () => {
    const input = [
      makeSample({ contentType: 'image/png' }),
      makeSample({ contentType: 'font/woff2' }),
      makeSample({ contentType: 'video/mp4' }),
      makeSample({ contentType: 'audio/mpeg' }),
      makeSample({ contentType: 'text/css' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'static')).toHaveLength(5)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('content-type')
    }
  })

  // -----------------------------------------------------------------------
  // Rule 5: static file extension → static
  // -----------------------------------------------------------------------
  it('labels static file extensions as static', () => {
    const input = [
      makeSample({ path: '/assets/app.js', contentType: 'application/javascript' }),
      makeSample({ path: '/styles/main.css', contentType: 'text/plain' }),
      makeSample({ path: '/images/logo.svg', contentType: 'application/octet-stream' }),
      makeSample({ path: '/fonts/roboto.woff2', contentType: 'application/octet-stream' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'static')).toHaveLength(4)
    for (const ls of result) {
      expect(ls.reasons[0]).toContain('extension')
    }
  })

  // -----------------------------------------------------------------------
  // Rule 6: everything else → api
  // -----------------------------------------------------------------------
  it('labels normal API requests as api', () => {
    const input = [
      makeSample({ path: '/api/v1/users', contentType: 'application/json' }),
      makeSample({ method: 'POST', path: '/api/v1/orders', contentType: 'application/json' }),
      makeSample({ path: '/graphql', contentType: 'application/json' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'api')).toHaveLength(3)
  })

  // -----------------------------------------------------------------------
  // Core invariants
  // -----------------------------------------------------------------------
  it('never drops samples — output length equals input length', () => {
    const input = [
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'off-domain.com' }),
      makeSample({ path: '/manifest.json' }),
      makeSample({ contentType: 'image/png' }),
      makeSample({ path: '/app.js', contentType: 'application/javascript' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(result).toHaveLength(input.length)
  })

  it('assigns unique ids and correct responseKind', () => {
    const input = [
      makeSample({ response: { kind: 'json', body: {} } }),
      makeSample({ response: { kind: 'text', body: 'hello' } }),
      makeSample({ response: { kind: 'empty' } }),
    ]

    const result = labelSamples(input, TARGET)
    const ids = result.map((ls) => ls.id)
    expect(new Set(ids).size).toBe(ids.length) // unique
    expect(result[0].responseKind).toBe('json')
    expect(result[1].responseKind).toBe('text')
    expect(result[2].responseKind).toBe('empty')
  })

  it('every labeled sample has non-empty reasons', () => {
    const input = [
      makeSample({}),
      makeSample({ host: 'www.google-analytics.com' }),
      makeSample({ host: 'off.com' }),
      makeSample({ path: '/_/tracking' }),
      makeSample({ contentType: 'image/jpeg' }),
      makeSample({ path: '/bundle.js', contentType: 'application/javascript' }),
    ]

    const result = labelSamples(input, TARGET)
    for (const ls of result) {
      expect(ls.reasons.length).toBeGreaterThan(0)
      expect(ls.reasons[0].length).toBeGreaterThan(0)
    }
  })

  // -----------------------------------------------------------------------
  // Priority order
  // -----------------------------------------------------------------------
  it('blocked-domain takes priority over off-domain', () => {
    // google-analytics.com is both blocked AND off-domain for example.com
    const input = [makeSample({ host: 'www.google-analytics.com' })]
    const result = labelSamples(input, TARGET)
    expect(result[0].category).toBe('tracking')
    expect(result[0].reasons[0]).toContain('blocked-domains')
  })

  it('off-domain takes priority over blocked-path', () => {
    // off-domain host with a blocked path — off_domain should win
    const input = [makeSample({ host: 'other-site.com', path: '/manifest.json' })]
    const result = labelSamples(input, TARGET)
    expect(result[0].category).toBe('off_domain')
  })

  // -----------------------------------------------------------------------
  // allowHosts option
  // -----------------------------------------------------------------------
  it('respects allowHosts to include extra domains', () => {
    const input = [
      makeSample({ host: 'custom-api.io' }),
      makeSample({ host: 'api.example.com' }),
      makeSample({ host: 'random.org' }),
    ]

    const result = labelSamples(input, TARGET, { allowHosts: ['custom-api.io'] })
    expect(byCategory(result, 'api')).toHaveLength(2)
    expect(byCategory(result, 'off_domain')).toHaveLength(1)
    expect(byCategory(result, 'off_domain')[0].sample.host).toBe('random.org')
  })

  // -----------------------------------------------------------------------
  // Does not false-positive real API paths
  // -----------------------------------------------------------------------
  it('does not false-positive on real API paths with similar words', () => {
    const input = [
      makeSample({ path: '/api/v1/tracking/shipments' }),
      makeSample({ path: '/api/v1/metrics/revenue' }),
      makeSample({ path: '/api/v1/analytics/reports' }),
      makeSample({ path: '/api/v1/pixel/campaigns' }),
    ]

    const result = labelSamples(input, TARGET)
    expect(byCategory(result, 'api')).toHaveLength(4)
  })
})
