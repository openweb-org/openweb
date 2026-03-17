import { describe, expect, it, vi } from 'vitest'

import { fetchWithRedirects } from './redirect.js'
import { OpenWebError } from '../lib/errors.js'

describe('fetchWithRedirects', () => {
  it('returns response on non-redirect status', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch

    const response = await fetchWithRedirects(
      'https://example.com/api',
      'GET',
      { Accept: 'application/json' },
      undefined,
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows 301 redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { location: 'https://example.com/api/v2' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch

    const response = await fetchWithRedirects(
      'https://example.com/api',
      'GET',
      { Accept: 'application/json' },
      undefined,
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(response.status).toBe(200)
  })

  it('switches to GET on 303', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 303,
        headers: { location: 'https://example.com/result' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch

    await fetchWithRedirects(
      'https://example.com/api',
      'POST',
      {},
      '{"data":true}',
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect((calls[0]![1] as RequestInit).method).toBe('POST')
    expect((calls[1]![1] as RequestInit).method).toBe('GET')
    expect((calls[1]![1] as RequestInit).body).toBeUndefined()
  })

  it('rewrites POST to GET on 301 redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { location: 'https://example.com/result' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch

    await fetchWithRedirects(
      'https://example.com/api',
      'POST',
      {},
      '{"data":true}',
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect((calls[0]![1] as RequestInit).method).toBe('POST')
    expect((calls[1]![1] as RequestInit).method).toBe('GET')
    expect((calls[1]![1] as RequestInit).body).toBeUndefined()
  })

  it('preserves method on 307 redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 307,
        headers: { location: 'https://example.com/result' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch

    await fetchWithRedirects(
      'https://example.com/api',
      'POST',
      {},
      '{"data":true}',
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect((calls[0]![1] as RequestInit).method).toBe('POST')
    expect((calls[1]![1] as RequestInit).method).toBe('POST')
  })

  it('strips sensitive headers on cross-origin redirect', async () => {
    const capturedHeaders: Record<string, string>[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders.push({ ...(init.headers as Record<string, string>) })
      if (capturedHeaders.length === 1) {
        return new Response('', {
          status: 301,
          headers: { location: 'https://other.com/callback' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchWithRedirects(
      'https://example.com/api',
      'GET',
      { Cookie: 'session=abc', Authorization: 'Bearer token' },
      undefined,
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(capturedHeaders[0]!.Cookie).toBe('session=abc')
    expect(capturedHeaders[1]!.Cookie).toBeUndefined()
    expect(capturedHeaders[1]!.Authorization).toBeUndefined()
  })

  it('throws on missing Location header', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 301 })) as unknown as typeof fetch

    await expect(
      fetchWithRedirects('https://example.com/api', 'GET', {}, undefined, {
        fetchImpl: fetchMock, ssrfValidator: async () => {},
      }),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('missing Location') },
    })
  })

  it('throws on too many redirects', async () => {
    let count = 0
    const fetchMock = vi.fn(async () => {
      count++
      return new Response('', {
        status: 301,
        headers: { location: `https://example.com/redirect/${count}` },
      })
    }) as unknown as typeof fetch

    await expect(
      fetchWithRedirects('https://example.com/api', 'GET', {}, undefined, {
        fetchImpl: fetchMock, ssrfValidator: async () => {},
      }),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('Too many redirects') },
    })
  })
})
