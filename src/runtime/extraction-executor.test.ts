import { describe, expect, it, vi } from 'vitest'

import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'
import { executeExtraction } from './extraction-executor.js'

function extractionBrowser(
  pages: Array<{ url: string; content?: string; evaluateResult?: unknown }>,
): import('playwright').Browser {
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
  } as unknown as import('playwright').Browser
}

function extractionSpec(serverUrl: string): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: { title: 'Extraction', version: '1.0' },
    servers: [
      {
        url: serverUrl,
        'x-openweb': {
          mode: 'session_http',
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
})
