import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import { executeOperation } from './executor.js'

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
})
