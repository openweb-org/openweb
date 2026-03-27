import { describe, expect, it, vi } from 'vitest'

import { verifyPackage, type VerifyInput, type VerifyOperationInput } from './verify-v2.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockOp(overrides: Partial<VerifyOperationInput> = {}): VerifyOperationInput {
  return {
    operationId: 'get_data',
    method: 'get',
    host: 'api.example.com',
    pathTemplate: '/v1/data',
    parameters: [],
    exampleInput: {},
    replaySafety: 'safe_read',
    ...overrides,
  }
}

const noopSsrf = async () => {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  })
}

function baseInput(
  ops: VerifyOperationInput[],
  fetchMock: typeof fetch,
  extra: Partial<VerifyInput> = {},
): VerifyInput {
  return {
    operations: ops,
    timeoutMs: 5000,
    fetchImpl: fetchMock,
    ssrfValidator: noopSsrf,
    ...extra,
  }
}

function result0(report: { results: readonly { overall: string }[] }) {
  return report.results[0]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyPackage', () => {
  it('safe_read passes with 200 JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock))

    expect(report.results).toHaveLength(1)
    const r = result0(report)
    expect(r?.overall).toBe('pass')
    expect(r?.publicWorks).toBe(true)
    expect(r?.authWorks).toBeNull()
    expect(r?.attempts).toHaveLength(1)
    expect(r?.attempts[0]?.mode).toBe('without_auth')
    expect(r?.attempts[0]?.reason).toBe('ok')
    expect(r?.attempts[0]?.statusCode).toBe(200)
  })

  it('safe_read with auth tries with_auth first', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock, {
      auth: { cookies: 'session=abc' },
    }))

    const r = result0(report)
    expect(r?.overall).toBe('pass')
    expect(r?.authWorks).toBe(true)
    // First attempt is with_auth, second is without_auth (public check)
    expect(r?.attempts).toHaveLength(2)
    expect(r?.attempts[0]?.mode).toBe('with_auth')
    expect(r?.attempts[1]?.mode).toBe('without_auth')
  })

  it('unsafe_mutation is skipped', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch

    const report = await verifyPackage(baseInput(
      [mockOp({ replaySafety: 'unsafe_mutation', operationId: 'delete_item' })],
      fetchMock,
    ))

    const r = result0(report)
    expect(r?.overall).toBe('skipped')
    expect(r?.authWorks).toBeNull()
    expect(r?.publicWorks).toBeNull()
    expect(r?.attempts).toHaveLength(0)
    // No HTTP requests made
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('401 response: authWorks=false, tries without_auth', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount++
      if (callCount === 1) return new Response('', { status: 401, headers: { 'content-type': 'application/json' } })
      return jsonResponse({ public: true })
    }) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock, {
      auth: { cookies: 'session=abc' },
    }))

    const r = result0(report)
    expect(r?.authWorks).toBe(false)
    expect(r?.attempts).toHaveLength(2)
    expect(r?.attempts[0]?.mode).toBe('with_auth')
    expect(r?.attempts[0]?.reason).toBe('auth_required')
    expect(r?.attempts[1]?.mode).toBe('without_auth')
    expect(r?.attempts[1]?.reason).toBe('ok')
    expect(r?.publicWorks).toBe(true)
    expect(r?.overall).toBe('pass')
  })

  it('404 response: fail, no second attempt', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('', { status: 404 }),
    ) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock, {
      auth: { cookies: 'session=abc' },
    }))

    const r = result0(report)
    expect(r?.overall).toBe('fail')
    expect(r?.authWorks).toBe(false)
    expect(r?.publicWorks).toBeNull()
    // Only one attempt — 404 stops escalation
    expect(r?.attempts).toHaveLength(1)
    expect(r?.attempts[0]?.reason).toBe('client_error')
  })

  it('timeout: fail with timeout reason', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      // Trigger the abort signal
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    }) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock, {
      timeoutMs: 50, // very short to trigger timeout
    }))

    const r = result0(report)
    expect(r?.overall).toBe('fail')
    expect(r?.attempts[0]?.reason).toBe('timeout')
  })

  it('no auth provided: only without_auth attempt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock))

    const r = result0(report)
    expect(r?.attempts).toHaveLength(1)
    expect(r?.attempts[0]?.mode).toBe('without_auth')
    expect(r?.authWorks).toBeNull()
  })

  it('multiple operations run in parallel with bounded concurrency', async () => {
    const inFlight: number[] = []
    let maxConcurrency = 0

    const fetchMock = vi.fn(async () => {
      inFlight.push(1)
      maxConcurrency = Math.max(maxConcurrency, inFlight.length)
      await new Promise((r) => setTimeout(r, 10))
      inFlight.pop()
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    const ops = Array.from({ length: 10 }, (_, i) =>
      mockOp({ operationId: `op_${i}` }),
    )

    const report = await verifyPackage({
      ...baseInput(ops, fetchMock),
      concurrency: 3,
    })

    expect(report.results).toHaveLength(10)
    expect(report.results.every((r) => r.overall === 'pass')).toBe(true)
    // Bounded concurrency should limit to 3
    expect(maxConcurrency).toBeLessThanOrEqual(3)
    expect(maxConcurrency).toBeGreaterThan(1)
  })

  it('URL construction uses buildQueryUrl with exampleInput', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch

    const op = mockOp({
      host: 'api.example.com',
      pathTemplate: '/v1/search',
      parameters: [
        { name: 'q', location: 'query', required: true, schema: { type: 'string' }, exampleValue: 'test' },
        { name: 'limit', location: 'query', required: false, schema: { type: 'integer', default: 10 }, exampleValue: 20 },
      ],
      exampleInput: { q: 'hello', limit: 20 },
    })

    await verifyPackage(baseInput([op], fetchMock))

    const calledUrl = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(calledUrl).toContain('q=hello')
    expect(calledUrl).toContain('limit=20')
    expect(calledUrl).toContain('api.example.com')
  })

  it('with_auth sends Cookie header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch

    await verifyPackage(baseInput([mockOp()], fetchMock, {
      auth: { cookies: 'session=abc123' },
    }))

    // First call should be with_auth — check Cookie header
    const firstCallInit = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(firstCallInit?.headers?.Cookie).toBe('session=abc123')
  })

  it('non-JSON 200 response returns non_json_response reason', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<html>Hello</html>')) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock))

    const r = result0(report)
    expect(r?.overall).toBe('fail')
    expect(r?.attempts[0]?.reason).toBe('non_json_response')
    expect(r?.attempts[0]?.contentType).toBe('text/html')
  })

  it('report includes generatedAt timestamp', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch

    const report = await verifyPackage(baseInput([mockOp()], fetchMock))

    expect(report.generatedAt).toBeDefined()
    expect(() => new Date(report.generatedAt)).not.toThrow()
  })

  it('SSRF blocked returns ssrf_blocked reason', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch
    const ssrfValidator = async () => {
      const err = new Error('SSRF blocked')
      throw err
    }

    const report = await verifyPackage({
      ...baseInput([mockOp()], fetchMock),
      ssrfValidator,
    })

    const r = result0(report)
    expect(r?.overall).toBe('fail')
    expect(r?.attempts[0]?.reason).toBe('ssrf_blocked')
  })
})
