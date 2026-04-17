import { describe, expect, it, vi } from 'vitest'

import type { OpenApiOperation, OpenApiSpec } from '../lib/spec-loader.js'
import { executeExtraction } from './extraction-executor.js'

function extractionBrowser(
  pages: Array<{ url: string; content?: string; evaluateResult?: unknown }>,
): import('patchright').Browser {
  return {
    contexts: () => [
      {
        cookies: vi.fn(async () => []),
        pages: () =>
          pages.map((page) => ({
            url: () => page.url,
            content: vi.fn(async () => page.content ?? '<html><body>ready</body></html>'),
            evaluate: vi.fn(async () => page.evaluateResult),
          })),
      },
    ],
    close: vi.fn(async () => {}),
  } as unknown as import('patchright').Browser
}

function extractionSpec(serverUrl: string): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: { title: 'Extraction', version: '1.0' },
    servers: [
      {
        url: serverUrl,
        'x-openweb': {
          transport: 'node',
        },
      } as unknown as { url: string },
    ],
    paths: {},
  }
}

function extractionOperation(extraction: Record<string, unknown>): OpenApiOperation {
  return {
    operationId: 'extract',
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object',
            },
          },
        },
      },
    },
    'x-openweb': { extraction },
  }
}

describe('executeExtraction', () => {
  it('runs ssr_next_data against the matched page', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://www.walmart.com/',
        evaluateResult: {
          props: {
            pageProps: {
              sections: [{ id: 'hero' }],
            },
          },
        },
      },
    ])

    const result = await executeExtraction(
      browser,
      extractionSpec('https://www.walmart.com'),
      extractionOperation({
        type: 'ssr_next_data',
        page_url: '/',
        path: 'props.pageProps.sections',
      }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual([{ id: 'hero' }])
  })

  it('surfaces needs_page with the exact page URL hint when no tab matches', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://example.com/',
      },
    ])

    await expect(
      executeExtraction(
        browser,
        extractionSpec('https://news.ycombinator.com'),
        extractionOperation({
          type: 'html_selector',
          page_url: '/news',
          selectors: {
            title: '.titleline > a',
          },
        }),
      ),
    ).rejects.toMatchObject({
      payload: {
        failureClass: 'needs_page',
        action: expect.stringContaining('https://news.ycombinator.com/news'),
      },
    })
  })

  it('requires an exact path match when page_url is configured', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://news.ycombinator.com/item?id=1',
      },
    ])

    await expect(
      executeExtraction(
        browser,
        extractionSpec('https://news.ycombinator.com'),
        extractionOperation({
          type: 'html_selector',
          page_url: '/news',
          selectors: {
            title: '.titleline > a',
          },
        }),
      ),
    ).rejects.toMatchObject({
      payload: {
        failureClass: 'needs_page',
        action: expect.stringContaining('https://news.ycombinator.com/news'),
      },
    })
  })

  it('routes page_global_data extraction through executeExtraction()', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://example.com/app',
        evaluateResult: {
          viewer: {
            profile: {
              id: 'user-1',
            },
          },
        },
      },
    ])

    const result = await executeExtraction(
      browser,
      extractionSpec('https://example.com'),
      extractionOperation({
        type: 'page_global_data',
        page_url: '/app',
        expression: 'window.__BOOTSTRAP__',
        path: 'viewer.profile.id',
      }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toBe('user-1')
  })

  it('substitutes path parameters into the target URL', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://www.amazon.com/dp/B0D77BX616',
        evaluateResult: { name: 'Test Product', price: '$29.99' },
      },
    ])

    const operation: OpenApiOperation = {
      operationId: 'getProductDetail',
      parameters: [
        { name: 'asin', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
      'x-openweb': {
        extraction: {
          type: 'page_global_data',
          expression: 'window.__DATA__',
        },
      },
    }

    const result = await executeExtraction(
      browser,
      extractionSpec('https://www.amazon.com'),
      operation,
      '/dp/{asin}',
      { asin: 'B0D77BX616' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ name: 'Test Product', price: '$29.99' })
  })

  it('substitutes path parameters into page_url when present', async () => {
    const browser = extractionBrowser([
      {
        url: 'https://www.example.com/product/ABC123',
        evaluateResult: { title: 'Widget' },
      },
    ])

    const operation: OpenApiOperation = {
      operationId: 'getProduct',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
      'x-openweb': {
        extraction: {
          type: 'page_global_data',
          page_url: '/product/{id}',
          expression: 'window.__DATA__',
        },
      },
    }

    const result = await executeExtraction(
      browser,
      extractionSpec('https://www.example.com'),
      operation,
      '/items/{id}',
      { id: 'ABC123' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ title: 'Widget' })
  })

  it('response_capture: acquires a fresh page, registers listener before goto, returns unwrapped body', async () => {
    // Track ordering: listener must be registered before page.goto is called.
    let listenerAt: number | null = null
    let gotoAt: number | null = null
    const handlers: Array<(resp: unknown) => Promise<void>> = []

    const fakePage = {
      url: () => 'about:blank',
      addInitScript: vi.fn(async () => {}),
      content: vi.fn(async () => '<html></html>'),
      evaluate: vi.fn(async () => undefined), // bot-detect no-op
      close: vi.fn(async () => {}),
      on: vi.fn((event: string, h: (resp: unknown) => Promise<void>) => {
        if (event === 'response') {
          handlers.push(h)
          if (listenerAt === null) listenerAt = Date.now()
        }
        return fakePage
      }),
      off: vi.fn(() => fakePage),
      goto: vi.fn(async () => {
        gotoAt = Date.now()
        const resp = {
          url: () => 'https://api.example.com/v1/search?q=foo',
          json: async () => ({ data: { results: [{ id: 1 }, { id: 2 }] } }),
        }
        // Fast response fires during navigation.
        await Promise.all(handlers.map((h) => h(resp)))
        return null
      }),
    }

    const browser = {
      contexts: () => [
        {
          cookies: vi.fn(async () => []),
          pages: () => [],
          newPage: vi.fn(async () => fakePage),
        },
      ],
      close: vi.fn(async () => {}),
    } as unknown as import('patchright').Browser

    const operation: OpenApiOperation = {
      operationId: 'search',
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
      'x-openweb': {
        extraction: {
          type: 'response_capture',
          page_url: 'https://web.example.com/search?q={q}',
          match_url: '*/v1/search*',
          unwrap: 'data.results',
        },
      },
    }

    const result = await executeExtraction(
      browser,
      extractionSpec('https://api.example.com'),
      operation,
      '/v1/search',
      { q: 'foo' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual([{ id: 1 }, { id: 2 }])
    expect(listenerAt).not.toBeNull()
    expect(gotoAt).not.toBeNull()
    expect(listenerAt).toBeLessThanOrEqual(gotoAt as number)
    // Fresh page — owned, must be closed.
    expect(fakePage.close).toHaveBeenCalled()
  })
})
