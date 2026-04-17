import { describe, expect, it, vi } from 'vitest'

import type { OpenApiSpec } from '../lib/spec-loader.js'
import { executeBrowserFetch } from './browser-fetch-executor.js'

function mockBrowser(
  pageUrl: string,
  evaluateResult: { status: number; headers: Record<string, string>; text: string },
  pageContent = '<html><body>ready</body></html>',
) {
  const page = {
    url: () => pageUrl,
    evaluate: vi.fn(async () => evaluateResult),
    content: vi.fn(async () => pageContent),
    addInitScript: vi.fn(async () => {}),
  }
  const context = {
    pages: () => [page],
    cookies: vi.fn(async () => []),
  }
  return {
    contexts: () => [context],
    close: vi.fn(async () => {}),
  } as unknown as import('patchright').Browser
}

const baseSpec: OpenApiSpec = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0' },
  servers: [
    {
      url: 'https://example.com/api',
      'x-openweb': { transport: 'page' },
    } as OpenApiSpec['servers'][0],
  ],
  paths: {},
}

describe('executeBrowserFetch', () => {
  it('executes fetch inside page.evaluate and returns parsed JSON', async () => {
    const browser = mockBrowser('https://example.com/api', {
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: '{"id":1,"name":"test"}',
    })

    const result = await executeBrowserFetch(
      browser,
      baseSpec,
      '/users/1',
      'get',
      { operationId: 'getUser', responses: {} },
      {},
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: 1, name: 'test' })
    expect(result.responseHeaders['content-type']).toBe('application/json')
  })

  it('passes headers and body for POST requests', async () => {
    const evaluateFn = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '{"ok":true}',
    }))
    const page = {
      url: () => 'https://example.com/api',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    await executeBrowserFetch(
      browser,
      baseSpec,
      '/items',
      'post',
      {
        operationId: 'createItem',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {},
      },
      { name: 'test-item' },
    )

    // calls[0] is the __name polyfill; calls[1] is the actual fetch
    const callArgs = evaluateFn.mock.calls[1]?.[1] as { url: string; method: string; headers: Record<string, string>; body: string }
    expect(callArgs.method).toBe('POST')
    expect(callArgs.body).toBe('{"name":"test-item"}')
    expect(callArgs.headers['Content-Type']).toBe('application/json')
  })

  it('sends an empty JSON object when requestBody is required but has no explicit fields', async () => {
    const evaluateFn = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '{"ok":true}',
    }))
    const page = {
      url: () => 'https://example.com/api',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    await executeBrowserFetch(
      browser,
      baseSpec,
      '/items',
      'post',
      {
        operationId: 'createItem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {},
              },
            },
          },
        },
        responses: {},
      },
      {},
    )

    // calls[0] is the __name polyfill; calls[1] is the actual fetch
    const callArgs = evaluateFn.mock.calls[1]?.[1] as { body: string; headers: Record<string, string> }
    expect(callArgs.body).toBe('{}')
    expect(callArgs.headers['Content-Type']).toBe('application/json')
  })

  it('throws on HTTP error status', async () => {
    const browser = mockBrowser('https://example.com/api', {
      status: 401,
      headers: {},
      text: 'Unauthorized',
    })

    await expect(
      executeBrowserFetch(
        browser,
        baseSpec,
        '/protected',
        'get',
        { operationId: 'getProtected', responses: {} },
        {},
      ),
    ).rejects.toMatchObject({
      payload: {
        code: 'AUTH_FAILED',
        message: 'HTTP 401',
        failureClass: 'needs_login',
        retriable: true,
      },
    })
  })

  it('throws on non-JSON response', async () => {
    const browser = mockBrowser('https://example.com/api', {
      status: 200,
      headers: {},
      text: '<html>Not JSON</html>',
    })

    await expect(
      executeBrowserFetch(
        browser,
        baseSpec,
        '/html',
        'get',
        { operationId: 'getHtml', responses: {} },
        {},
      ),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })

  it('throws when no browser context available', async () => {
    const browser = {
      contexts: () => [],
    } as unknown as import('patchright').Browser

    await expect(
      executeBrowserFetch(
        browser,
        baseSpec,
        '/test',
        'get',
        { operationId: 'test', responses: {} },
        {},
      ),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })

  it('does not inject Cookie header (browser handles via credentials:include)', async () => {
    const evaluateFn = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '{"ok":true}',
    }))
    const page = {
      url: () => 'https://example.com/api',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => [
        { name: 'session', value: 'abc', domain: '.example.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' as const, expires: -1 },
      ]),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    const specWithAuth: OpenApiSpec = {
      ...baseSpec,
      servers: [
        {
          url: 'https://example.com/api',
          'x-openweb': { transport: 'page', auth: { type: 'cookie_session' } },
        } as OpenApiSpec['servers'][0],
      ],
    }

    await executeBrowserFetch(
      browser,
      specWithAuth,
      '/me',
      'get',
      { operationId: 'getMe', responses: {} },
      {},
    )

    // calls[0] is the __name polyfill; calls[1] is the actual fetch
    const callArgs = evaluateFn.mock.calls[1]?.[1] as { headers: Record<string, string> }
    expect(callArgs.headers.Cookie).toBeUndefined()
  })

  it('throws needs_page when no matching site tab is open', async () => {
    const page = {
      url: () => 'https://unrelated.example.net',
      evaluate: vi.fn(),
      content: vi.fn(async () => '<html><body>other</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    await expect(
      executeBrowserFetch(
        browser,
        baseSpec,
        '/users/1',
        'get',
        { operationId: 'getUser', responses: {} },
        {},
      ),
    ).rejects.toMatchObject({
      payload: {
        failureClass: 'needs_page',
        action: expect.stringContaining('https://example.com/'),
      },
    })
  })

  it('applies query defaults before executing browser fetch', async () => {
    const evaluateFn = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '{"ok":true}',
    }))
    const page = {
      url: () => 'https://discord.com/channels/@me',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>discord</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Discord', version: '1.0' },
      servers: [
        {
          url: 'https://discord.com/api/v9',
          'x-openweb': { transport: 'page' },
        } as OpenApiSpec['servers'][0],
      ],
      paths: {},
    }

    await executeBrowserFetch(
      browser,
      spec,
      '/users/@me/guilds',
      'get',
      {
        operationId: 'getGuilds',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } },
        ],
        responses: {},
      },
      {},
    )

    // calls[0] is the __name polyfill; calls[1] is the actual fetch
    const callArgs = evaluateFn.mock.calls[1]?.[1] as { url: string }
    expect(callArgs.url).toContain('limit=200')
  })

  it('retries on TypeError: Failed to fetch and succeeds on retry', async () => {
    let call = 0
    const evaluateFn = vi.fn(async () => {
      call++
      // First call is the __name polyfill, second is first fetch attempt (fails),
      // third is the retry attempt (succeeds).
      if (call === 2) {
        throw new TypeError('Failed to fetch')
      }
      return { status: 200, headers: { 'content-type': 'application/json' }, text: '{"ok":true}' }
    })
    const page = {
      url: () => 'https://example.com/api',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    const result = await executeBrowserFetch(
      browser,
      baseSpec,
      '/users/1',
      'get',
      { operationId: 'getUser', responses: {} },
      {},
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    // __name polyfill + failed fetch + retried fetch = 3 evaluate calls
    expect(evaluateFn).toHaveBeenCalledTimes(3)
  })

  it('classifies TypeError: Failed to fetch as retriable after exhausting retries', async () => {
    let fetchCalls = 0
    // All evaluate calls with fetch-shaped args throw; other evaluate calls
    // (polyfills, warm-session probes) return undefined so setup can proceed.
    const wrapped = vi.fn(async (_fn: unknown, args?: unknown) => {
      const maybeArgs = args as { url?: string; method?: string } | undefined
      if (maybeArgs && typeof maybeArgs.url === 'string' && typeof maybeArgs.method === 'string') {
        fetchCalls++
        throw new TypeError('Failed to fetch')
      }
      return undefined
    })
    const page = {
      url: () => 'https://example.com/api',
      evaluate: wrapped,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    await expect(
      executeBrowserFetch(
        browser,
        baseSpec,
        '/users/1',
        'get',
        { operationId: 'getUser', responses: {} },
        {},
      ),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
        failureClass: 'retriable',
        retriable: true,
        message: expect.stringContaining('Failed to fetch'),
      },
    })
    // MAX_ATTEMPTS = 3 fetch attempts made before surfacing
    expect(fetchCalls).toBe(3)
  })

  it('substitutes server-variable {subdomain} from caller params into the request URL', async () => {
    const evaluateFn = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: '{"ok":true}',
    }))
    const page = {
      url: () => 'https://test.substack.com/',
      evaluate: evaluateFn,
      content: vi.fn(async () => '<html><body>ready</body></html>'),
      addInitScript: vi.fn(async () => {}),
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
      newPage: vi.fn(async () => page),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('patchright').Browser

    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Substack', version: '1.0' },
      servers: [
        {
          url: 'https://{subdomain}.substack.com',
          variables: { subdomain: { default: 'www' } },
          'x-openweb': { transport: 'page' },
        } as OpenApiSpec['servers'][0],
      ],
      paths: {},
    }

    await executeBrowserFetch(
      browser,
      spec,
      '/api/v1/feed',
      'get',
      {
        operationId: 'getFeed',
        parameters: [
          { name: 'subdomain', in: 'query', schema: { type: 'string' } },
        ],
        responses: {},
      },
      { subdomain: 'test' },
    )

    const callArgs = evaluateFn.mock.calls[1]?.[1] as { url: string }
    expect(callArgs.url.startsWith('https://test.substack.com/api/v1/feed')).toBe(true)
  })
})
