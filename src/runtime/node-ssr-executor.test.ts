import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import { executeNodeSsr } from './node-ssr-executor.js'

// ── Helpers ─────────────────────────────────────────

function htmlWithNextData(jsonPayload: unknown): string {
  return `<!DOCTYPE html>
<html><head><title>Test</title></head><body>
<div id="__next">content</div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(jsonPayload)}</script>
</body></html>`
}

function okResponse(body: string, headers?: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html', ...headers },
  })
}

function errorResponse(status: number): Response {
  return new Response('Error', { status })
}

const noopSsrf = async () => {}

function extraction(path: string): { type: 'ssr_next_data'; path: string } {
  return { type: 'ssr_next_data', path }
}

// ── Tests ───────────────────────────────────────────

describe('executeNodeSsr', () => {
  it('extracts data at a given path from __NEXT_DATA__', async () => {
    const payload = {
      props: {
        pageProps: {
          items: [{ id: 1, name: 'Widget' }],
        },
      },
    }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    const result = await executeNodeSsr(
      'https://example.com/products',
      extraction('props.pageProps.items'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual([{ id: 1, name: 'Widget' }])
    expect(result.responseHeaders['content-type']).toBe('text/html')
  })

  it('extracts nested scalar value', async () => {
    const payload = { props: { pageProps: { title: 'Hello World' } } }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    const result = await executeNodeSsr(
      'https://example.com/page',
      extraction('props.pageProps.title'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toBe('Hello World')
  })

  it('returns entire __NEXT_DATA__ when path is empty', async () => {
    const payload = { props: { pageProps: { data: 42 } } }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    const result = await executeNodeSsr(
      'https://example.com/page',
      extraction(''),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toEqual(payload)
  })

  it('sends correct request headers', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(htmlWithNextData({ props: { pageProps: {} } })),
    )

    await executeNodeSsr(
      'https://example.com/page',
      extraction('props'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/page')
    expect((init.headers as Record<string, string>)['Accept']).toContain('text/html')
    expect((init.headers as Record<string, string>)['User-Agent']).toBeDefined()
  })

  it('calls SSRF validator before fetching', async () => {
    const ssrfValidator = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () =>
      okResponse(htmlWithNextData({ props: {} })),
    )

    await executeNodeSsr(
      'https://example.com/page',
      extraction('props'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator },
    )

    expect(ssrfValidator).toHaveBeenCalledWith('https://example.com/page')
  })
})

describe('executeNodeSsr — error handling', () => {
  it('throws on non-OK HTTP response', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(403))

    await expect(
      executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
        message: expect.stringContaining('403'),
        failureClass: 'needs_login',
      },
    })
  })

  it('throws retriable error on 500', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(500))

    try {
      await executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      )
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(OpenWebError)
      const owErr = err as OpenWebError
      expect(owErr.payload.retriable).toBe(true)
      expect(owErr.payload.failureClass).toBe('retriable')
    }
  })

  it('throws on 404 with non-retriable fatal error', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(404))

    try {
      await executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      )
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(OpenWebError)
      const owErr = err as OpenWebError
      expect(owErr.payload.retriable).toBe(false)
      expect(owErr.payload.failureClass).toBe('fatal')
    }
  })

  it('throws when __NEXT_DATA__ script tag is missing', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse('<html><body>No next data here</body></html>'),
    )

    await expect(
      executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        message: expect.stringContaining('__NEXT_DATA__'),
        failureClass: 'fatal',
      },
    })
  })

  it('throws when __NEXT_DATA__ script has no closing tag', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(
        '<html><body><script id="__NEXT_DATA__" type="application/json">{"a":1}',
      ),
    )

    await expect(
      executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        message: expect.stringContaining('malformed'),
        failureClass: 'fatal',
      },
    })
  })

  it('throws when __NEXT_DATA__ contains invalid JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(
        '<html><body><script id="__NEXT_DATA__" type="application/json">{invalid json}</script></body></html>',
      ),
    )

    await expect(
      executeNodeSsr(
        'https://example.com/page',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        message: expect.stringContaining('invalid JSON'),
        failureClass: 'fatal',
      },
    })
  })

  it('throws when extraction path is not found in __NEXT_DATA__', async () => {
    const payload = { props: { pageProps: { data: 42 } } }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    await expect(
      executeNodeSsr(
        'https://example.com/page',
        extraction('props.nonexistent.deep'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        message: expect.stringContaining('props.nonexistent.deep'),
        failureClass: 'fatal',
      },
    })
  })

  it('propagates SSRF validation errors', async () => {
    const ssrfValidator = vi.fn(async () => {
      throw new Error('SSRF blocked')
    })
    const fetchImpl = vi.fn()

    await expect(
      executeNodeSsr(
        'http://169.254.169.254/metadata',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator },
      ),
    ).rejects.toThrow('SSRF blocked')

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
