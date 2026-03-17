import { describe, expect, it, vi } from 'vitest'

import { probeOperations, mergeProbeResults, type ProbeResult } from './prober.js'
import type { AnalyzedOperation } from './types.js'
import type { ClassifyResult } from './analyzer/classify.js'

function mockOperation(overrides: Partial<AnalyzedOperation> = {}): AnalyzedOperation {
  return {
    method: 'get',
    host: 'api.example.com',
    path: '/v1/data',
    operationId: 'get_data',
    summary: 'Get data',
    parameters: [],
    responseSchema: { type: 'object' },
    exampleInput: {},
    verified: false,
    ...overrides,
  }
}

const noopSsrf = async () => {}

describe('probeOperations', () => {
  it('returns node_no_auth when fetch succeeds without cookies', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch

    const results = await probeOperations(
      [mockOperation()],
      'https://api.example.com',
      { fetchImpl: fetchMock, timeout: 1000, ssrfValidator: noopSsrf },
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.probeMethod).toBe('node_no_auth')
    expect(results[0]!.authRequired).toBe(false)
    expect(results[0]!.transport).toBe('node')
  })

  it('skips non-GET operations', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch

    const results = await probeOperations(
      [mockOperation({ method: 'post', operationId: 'create_item' })],
      'https://api.example.com',
      { fetchImpl: fetchMock, timeout: 1000, ssrfValidator: noopSsrf },
    )

    expect(results).toHaveLength(0)
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('returns empty when fetch returns 404', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('', { status: 404 }),
    ) as unknown as typeof fetch

    const results = await probeOperations(
      [mockOperation()],
      'https://api.example.com',
      { fetchImpl: fetchMock, timeout: 1000, ssrfValidator: noopSsrf },
    )

    expect(results).toHaveLength(0)
  })

  it('returns node_with_auth when 401 then cookies succeed', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response('', { status: 401 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    const mockBrowser = {
      contexts: () => [{
        cookies: vi.fn(async () => [
          { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
        ]),
      }],
    } as unknown as import('playwright').Browser

    const results = await probeOperations(
      [mockOperation()],
      'https://api.example.com',
      { fetchImpl: fetchMock, browser: mockBrowser, timeout: 1000, ssrfValidator: noopSsrf },
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.probeMethod).toBe('node_with_auth')
    expect(results[0]!.authRequired).toBe(true)
  })

  it('returns empty when fetch throws (network error)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch

    const results = await probeOperations(
      [mockOperation()],
      'https://api.example.com',
      { fetchImpl: fetchMock, timeout: 1000, ssrfValidator: noopSsrf },
    )

    expect(results).toHaveLength(0)
  })
})

describe('mergeProbeResults', () => {
  const baseClassify: ClassifyResult = {
    transport: 'page',
    auth: { type: 'cookie_session' },
  }

  it('overrides transport when probe shows node works', () => {
    const probes: ProbeResult[] = [{
      operationId: 'get_data',
      transport: 'node',
      authRequired: false,
      status: 200,
      probeMethod: 'node_no_auth',
    }]

    const merged = mergeProbeResults(baseClassify, probes)
    expect(merged.transport).toBe('node')
    expect(merged.auth).toBeUndefined()
  })

  it('preserves classify auth when probe shows auth needed', () => {
    const probes: ProbeResult[] = [{
      operationId: 'get_data',
      transport: 'node',
      authRequired: true,
      status: 200,
      probeMethod: 'node_with_auth',
    }]

    const merged = mergeProbeResults(baseClassify, probes)
    expect(merged.transport).toBe('node')
    expect(merged.auth).toEqual({ type: 'cookie_session' })
  })

  it('returns original classify when no probes', () => {
    const merged = mergeProbeResults(baseClassify, [])
    expect(merged).toEqual(baseClassify)
  })
})
