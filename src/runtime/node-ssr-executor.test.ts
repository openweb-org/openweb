import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import { executeNodeExtraction } from './node-ssr-executor.js'

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

describe('executeNodeExtraction', () => {
  it('extracts data at a given path from __NEXT_DATA__', async () => {
    const payload = {
      props: {
        pageProps: {
          items: [{ id: 1, name: 'Widget' }],
        },
      },
    }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    const result = await executeNodeExtraction(
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

    const result = await executeNodeExtraction(
      'https://example.com/page',
      extraction('props.pageProps.title'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toBe('Hello World')
  })

  it('returns entire __NEXT_DATA__ when path is empty', async () => {
    const payload = { props: { pageProps: { data: 42 } } }
    const fetchImpl = vi.fn(async () => okResponse(htmlWithNextData(payload)))

    const result = await executeNodeExtraction(
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

    await executeNodeExtraction(
      'https://example.com/page',
      extraction('props'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/page')
    expect((init.headers as Record<string, string>).Accept).toContain('text/html')
    expect((init.headers as Record<string, string>)['User-Agent']).toBeDefined()
  })

  it('calls SSRF validator before fetching', async () => {
    const ssrfValidator = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () =>
      okResponse(htmlWithNextData({ props: {} })),
    )

    await executeNodeExtraction(
      'https://example.com/page',
      extraction('props'),
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator },
    )

    expect(ssrfValidator).toHaveBeenCalledWith('https://example.com/page')
  })
})

describe('executeNodeExtraction — error handling', () => {
  it('throws on non-OK HTTP response', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(403))

    await expect(
      executeNodeExtraction(
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
      await executeNodeExtraction(
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
      await executeNodeExtraction(
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
      executeNodeExtraction(
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
      executeNodeExtraction(
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
      executeNodeExtraction(
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
      executeNodeExtraction(
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
      executeNodeExtraction(
        'http://169.254.169.254/metadata',
        extraction('props'),
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator },
      ),
    ).rejects.toThrow('SSRF blocked')

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ── script_json path ────────────────────────────────

describe('executeNodeExtraction — script_json', () => {
  it('extracts JSON from script#id via node path (no browser)', async () => {
    const html = `<html><body><script id="repo-data" type="application/json">{"owner":"openweb","stars":42}</script></body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/repo',
      { type: 'script_json', selector: 'script#repo-data' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ owner: 'openweb', stars: 42 })
  })

  it('extracts JSON-LD from script[type="application/ld+json"]', async () => {
    const html = `<html><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget"}</script></body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/item',
      { type: 'script_json', selector: 'script[type="application/ld+json"]' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toMatchObject({ '@type': 'Product', name: 'Widget' })
  })

  it('strip_comments=true unwraps <!-- ... --> JSON (Yelp-style)', async () => {
    const html = `<html><body><script id="wrapped" type="application/json">
<!--
{"k":1,"nested":{"v":2}}
-->
</script></body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/page',
      { type: 'script_json', selector: 'script#wrapped', strip_comments: true },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toEqual({ k: 1, nested: { v: 2 } })
  })

  it('fails to parse HTML-commented JSON when strip_comments is not set', async () => {
    const html = `<html><body><script id="wrapped" type="application/json"><!--{"k":1}--></script></body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    await expect(
      executeNodeExtraction(
        'https://example.com/page',
        { type: 'script_json', selector: 'script#wrapped' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('not valid JSON'), failureClass: 'fatal' },
    })
  })

  it('extracts at a sub-path when path is provided', async () => {
    const html = `<html><body><script id="data" type="application/json">{"products":{"list":[{"id":1}]}}</script></body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/page',
      { type: 'script_json', selector: 'script#data', path: 'products.list' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toEqual([{ id: 1 }])
  })

  it('throws retriable error when selector does not match any script tag', async () => {
    const html = '<html><body><script>var x=1</script></body></html>'
    const fetchImpl = vi.fn(async () => okResponse(html))

    await expect(
      executeNodeExtraction(
        'https://example.com/page',
        { type: 'script_json', selector: 'script#missing' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('not found'), retriable: true },
    })
  })
})

// ── script_json path ────────────────────────────────

describe('executeNodeExtraction — script_json', () => {
  it('extracts JSON from a <script id="..."> via node path (no browser)', async () => {
    const html = `<html><body>
<script id="repo-data" type="application/json">{"owner":"openweb","stars":42}</script>
</body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/repo',
      { type: 'script_json', selector: 'script#repo-data' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ owner: 'openweb', stars: 42 })
  })

  it('extracts JSON-LD from script[type="application/ld+json"]', async () => {
    const html = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget"}</script>
</body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/item',
      { type: 'script_json', selector: 'script[type="application/ld+json"]' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toMatchObject({ '@type': 'Product', name: 'Widget' })
  })

  it('strip_comments=true unwraps <!-- ... --> JSON (Yelp-style)', async () => {
    const html = `<html><body>
<script id="wrapped" type="application/json">
<!--
{"k":1,"nested":{"v":2}}
-->
</script>
</body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/page',
      { type: 'script_json', selector: 'script#wrapped', strip_comments: true },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toEqual({ k: 1, nested: { v: 2 } })
  })

  it('fails to parse HTML-commented JSON when strip_comments is not set', async () => {
    const html = `<html><body>
<script id="wrapped" type="application/json"><!--{"k":1}--></script>
</body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    await expect(
      executeNodeExtraction(
        'https://example.com/page',
        { type: 'script_json', selector: 'script#wrapped' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('not valid JSON'), failureClass: 'fatal' },
    })
  })

  it('extracts at a sub-path when path is provided', async () => {
    const html = `<html><body>
<script id="data" type="application/json">{"products":{"list":[{"id":1}]}}</script>
</body></html>`
    const fetchImpl = vi.fn(async () => okResponse(html))

    const result = await executeNodeExtraction(
      'https://example.com/page',
      { type: 'script_json', selector: 'script#data', path: 'products.list' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result.body).toEqual([{ id: 1 }])
  })

  it('throws retriable error when selector does not match any script tag', async () => {
    const html = '<html><body><script>var x=1</script></body></html>'
    const fetchImpl = vi.fn(async () => okResponse(html))

    await expect(
      executeNodeExtraction(
        'https://example.com/page',
        { type: 'script_json', selector: 'script#missing' },
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('not found'), retriable: true },
    })
  })
})
