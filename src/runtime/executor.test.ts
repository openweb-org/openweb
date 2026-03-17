import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import { executeOperation, fetchWithValidatedRedirects } from './executor.js'

describe('executeOperation', () => {
  it('uses per-operation server override and returns JSON body', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => {
      return new Response(
        JSON.stringify({
          results: [{ name: 'Berlin', latitude: 52.52, longitude: 13.41 }],
          generationtime_ms: 1,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as unknown as typeof fetch

    const ssrfMock = vi.fn(async () => {})

    const result = await executeOperation(
      'open-meteo-fixture',
      'search_location',
      { name: 'Berlin', count: 1 },
      { fetchImpl: fetchMock, ssrfValidator: ssrfMock },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const calledUrl = String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(calledUrl).toContain('https://geocoding-api.open-meteo.com/v1/search?')
    expect(calledUrl).toContain('name=Berlin')
  })

  it('throws INVALID_PARAMS when required params are missing', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch

    await expect(
      executeOperation('open-meteo-fixture', 'get_forecast', { longitude: 13.41 }, { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      payload: {
        code: 'INVALID_PARAMS',
      },
    })
  })

  it('warns but does not fail when response schema mismatches', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ invalid: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const ssrfMock = vi.fn(async () => {})

    const result = await executeOperation(
      'open-meteo-fixture',
      'search_location',
      { name: 'Berlin' },
      { fetchImpl: fetchMock, ssrfValidator: ssrfMock },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(false)
  })

  it('raises OpenWebError for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'bad' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(
      executeOperation('open-meteo-fixture', 'search_location', { name: 'Berlin' }, { fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenWebError)
  })

  it('switches to GET and drops the body on a 303 redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 303,
        headers: { location: 'https://api.example.com/v1/result' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

    const response = await fetchWithValidatedRedirects(
      'https://api.example.com/v1/start',
      'POST',
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      {
        body: JSON.stringify({ draft: true }),
        headers: { 'Content-Type': 'application/json' },
      },
    )

    expect(response.status).toBe(200)

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect((calls[0]![1] as RequestInit).method).toBe('POST')
    expect((calls[0]![1] as RequestInit).body).toBe(JSON.stringify({ draft: true }))
    expect((calls[1]![1] as RequestInit).method).toBe('GET')
    expect((calls[1]![1] as RequestInit).body).toBeUndefined()
  })

  it('throws when a redirect response omits the Location header', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 302 })) as unknown as typeof fetch

    await expect(
      fetchWithValidatedRedirects(
        'https://api.example.com/v1/start',
        'GET',
        { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('missing Location header') },
    })
  })
})
