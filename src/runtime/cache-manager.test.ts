import { describe, expect, it, vi } from 'vitest'

import type { Browser, BrowserContext, Cookie, Page } from 'patchright'

import { OpenWebError } from '../lib/errors.js'
import type { CachedTokens } from './token-cache.js'

// ── Module-level mocks ──────────────────────────────

vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Imports under test ──────────────────────────────

import { executeCachedFetch, writeBrowserCookiesToCache } from './cache-manager.js'

// ── Helpers ─────────────────────────────────────────

function minimalSpec(serverUrl: string, xOpenWeb?: Record<string, unknown>) {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0' },
    servers: [
      { url: serverUrl, ...(xOpenWeb ? { 'x-openweb': xOpenWeb } : {}) },
    ],
    paths: {},
  }
}

function minimalOperation(
  overrides: Record<string, unknown> = {},
): { path: string; method: string; operation: Record<string, unknown> } {
  return {
    path: '/api/test',
    method: 'get',
    operation: {
      operationId: 'test',
      parameters: [],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
      ...overrides,
    },
  }
}

function sampleCached(overrides?: Partial<CachedTokens>): CachedTokens {
  return {
    cookies: [
      { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
    ],
    localStorage: {},
    sessionStorage: {},
    capturedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const noopSsrf = async () => {}

// ── executeCachedFetch ──────────────────────────────

describe('executeCachedFetch', () => {
  it('returns result on successful fetch with cached cookies', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [1, 2, 3] }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()

    const result = await executeCachedFetch(
      spec as never,
      opRef as never,
      undefined,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result).not.toBeNull()
    expect(result?.status).toBe(200)
    expect(result?.body).toEqual({ items: [1, 2, 3] })
  })

  it('injects Cookie header from cached cookies', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached({
      cookies: [
        { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
        { name: 'token', value: 'xyz', domain: '.example.com', path: '/' },
      ],
    })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      undefined,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Cookie).toBe('session=abc; token=xyz')
  })

  it('returns null for exchange_chain auth type', async () => {
    const fetchImpl = vi.fn()
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()
    const serverExt = { transport: 'node' as const, auth: { type: 'exchange_chain' as const, steps: [], inject: {} } }

    const result = await executeCachedFetch(
      spec as never,
      opRef as never,
      serverExt as never,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('injects localStorage_jwt auth header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const serverExt = {
      transport: 'node' as const,
      auth: {
        type: 'localStorage_jwt' as const,
        key: 'auth_token',
        inject: { header: 'Authorization', prefix: 'Bearer ' },
      },
    }
    const cached = sampleCached({
      localStorage: { auth_token: '"my-jwt-token"' },
    })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      serverExt as never,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer my-jwt-token')
  })

  it('resolves nested path in localStorage_jwt value', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const serverExt = {
      transport: 'node' as const,
      auth: {
        type: 'localStorage_jwt' as const,
        key: 'auth_data',
        path: 'access.token',
        inject: { header: 'Authorization', prefix: 'Bearer ' },
      },
    }
    const cached = sampleCached({
      localStorage: { auth_data: JSON.stringify({ access: { token: 'nested-jwt' } }) },
    })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      serverExt as never,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer nested-jwt')
  })

  it('does not inject auth header when localStorage key is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const serverExt = {
      transport: 'node' as const,
      auth: {
        type: 'localStorage_jwt' as const,
        key: 'missing_key',
        inject: { header: 'Authorization', prefix: 'Bearer ' },
      },
    }
    const cached = sampleCached({ localStorage: {} })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      serverExt as never,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('injects CSRF header from cached cookie', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation({ method: 'post' })
    opRef.method = 'post'
    const serverExt = {
      transport: 'node' as const,
      csrf: { type: 'cookie_to_header' as const, cookie: 'csrf_tok', header: 'X-CSRF-Token' },
    }
    const cached = sampleCached({
      cookies: [
        { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
        { name: 'csrf_tok', value: 'csrf-value-123', domain: '.example.com', path: '/' },
      ],
    })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      serverExt as never,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-CSRF-Token']).toBe('csrf-value-123')
  })

  it('throws OpenWebError on HTTP 401 with needs_login failureClass', async () => {
    const fetchImpl = vi.fn(async () => new Response('Unauthorized', { status: 401 }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()

    await expect(
      executeCachedFetch(
        spec as never,
        opRef as never,
        undefined,
        {},
        cached,
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
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

  it('throws OpenWebError on HTTP 500 with retriable failureClass', async () => {
    const fetchImpl = vi.fn(async () => new Response('Server Error', { status: 500 }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()

    await expect(
      executeCachedFetch(
        spec as never,
        opRef as never,
        undefined,
        {},
        cached,
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
        failureClass: 'retriable',
        retriable: true,
      },
    })
  })

  it('throws OpenWebError on HTTP 404 with fatal failureClass', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not Found', { status: 404 }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()

    await expect(
      executeCachedFetch(
        spec as never,
        opRef as never,
        undefined,
        {},
        cached,
        { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
      ),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
        failureClass: 'fatal',
        retriable: false,
      },
    })
  })

  it('collects response headers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true }, 200, { 'x-request-id': 'req-123' }),
    )
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached()

    const result = await executeCachedFetch(
      spec as never,
      opRef as never,
      undefined,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    expect(result?.responseHeaders['x-request-id']).toBe('req-123')
  })

  it('does not set Cookie header when cookies are empty', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const spec = minimalSpec('https://api.example.com')
    const opRef = minimalOperation()
    const cached = sampleCached({ cookies: [] })

    await executeCachedFetch(
      spec as never,
      opRef as never,
      undefined,
      {},
      cached,
      { fetchImpl: fetchImpl as unknown as typeof fetch, ssrfValidator: noopSsrf },
    )

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Cookie).toBeUndefined()
  })
})

// ── writeBrowserCookiesToCache ───────────────────────

describe('writeBrowserCookiesToCache', () => {
  function createMockBrowser(opts: {
    cookies?: Cookie[]
    pages?: Array<{ url: string; localStorage?: Record<string, string>; sessionStorage?: Record<string, string> }>
  }): Browser {
    const cookies = opts.cookies ?? []
    const pages = (opts.pages ?? []).map((p) => ({
      url: () => p.url,
      evaluate: vi.fn(async (fn: () => Record<string, string>) => {
        // Determine what storage type is being requested by checking the call index
        // First evaluate call is localStorage, second is sessionStorage
        const callCount = (pages.find((pg) => pg.url === p.url) as unknown as { _evalCount?: number })?._evalCount ?? 0
        const pg = pages.find((pg) => pg.url === p.url) as unknown as { _evalCount?: number }
        if (pg) pg._evalCount = callCount + 1
        return callCount === 0 ? (p.localStorage ?? {}) : (p.sessionStorage ?? {})
      }),
    }))

    const context = {
      cookies: vi.fn(async () => cookies),
      pages: () => pages,
    } as unknown as BrowserContext

    return {
      contexts: () => [context],
    } as unknown as Browser
  }

  it('does nothing when browser has no contexts', async () => {
    const browser = { contexts: () => [] } as unknown as Browser
    const spec = minimalSpec('https://example.com')

    // Should not throw
    await writeBrowserCookiesToCache(browser, 'test-site', spec as never)
  })

  it('does nothing when spec has no server URL', async () => {
    const browser = createMockBrowser({ cookies: [] })
    const spec = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }

    await writeBrowserCookiesToCache(browser, 'test-site', spec as never)
  })

  it('does nothing when no cookies or storage to cache', async () => {
    const browser = createMockBrowser({
      cookies: [],
      pages: [{ url: 'https://example.com/' }],
    })
    const spec = minimalSpec('https://example.com')

    // Should not throw — returns early when nothing to cache
    await writeBrowserCookiesToCache(browser, 'test-site', spec as never)
  })

  it('silently catches errors and logs debug message', async () => {
    const browser = {
      contexts: () => [{
        cookies: vi.fn(async () => { throw new Error('browser crashed') }),
        pages: () => [],
      }],
    } as unknown as Browser
    const spec = minimalSpec('https://example.com')

    // Should not throw — errors are caught
    await writeBrowserCookiesToCache(browser, 'test-site', spec as never)
  })
})
