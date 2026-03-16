import { describe, expect, it, vi } from 'vitest'

import { executeBrowserFetch } from './browser-fetch-executor.js'
import type { OpenApiSpec } from '../lib/openapi.js'

function mockBrowser(pageUrl: string, evaluateResult: { status: number; headers: Record<string, string>; text: string }) {
  const page = {
    url: () => pageUrl,
    evaluate: vi.fn(async () => evaluateResult),
  }
  const context = {
    pages: () => [page],
    cookies: vi.fn(async () => []),
  }
  return {
    contexts: () => [context],
    close: vi.fn(async () => {}),
  } as unknown as import('playwright').Browser
}

const baseSpec: OpenApiSpec = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0' },
  servers: [
    {
      url: 'https://example.com/api',
      'x-openweb': { mode: 'browser_fetch' },
    } as OpenApiSpec['servers'][0],
  ],
  paths: {},
}

describe('executeBrowserFetch', () => {
  it('executes fetch inside page.evaluate and returns parsed JSON', async () => {
    const browser = mockBrowser('https://example.com', {
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
      url: () => 'https://example.com',
      evaluate: evaluateFn,
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => []),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('playwright').Browser

    await executeBrowserFetch(
      browser,
      baseSpec,
      '/items',
      'post',
      { operationId: 'createItem', responses: {} },
      { name: 'test-item' },
    )

    const callArgs = evaluateFn.mock.calls[0]![1] as { url: string; method: string; headers: Record<string, string>; body: string }
    expect(callArgs.method).toBe('POST')
    expect(callArgs.body).toBe('{"name":"test-item"}')
    expect(callArgs.headers['Content-Type']).toBe('application/json')
  })

  it('throws on HTTP error status', async () => {
    const browser = mockBrowser('https://example.com', {
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
      payload: { code: 'EXECUTION_FAILED', message: 'HTTP 401' },
    })
  })

  it('throws on non-JSON response', async () => {
    const browser = mockBrowser('https://example.com', {
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
    } as unknown as import('playwright').Browser

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
      url: () => 'https://example.com',
      evaluate: evaluateFn,
    }
    const context = {
      pages: () => [page],
      cookies: vi.fn(async () => [
        { name: 'session', value: 'abc', domain: '.example.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' as const, expires: -1 },
      ]),
    }
    const browser = {
      contexts: () => [context],
    } as unknown as import('playwright').Browser

    const specWithAuth: OpenApiSpec = {
      ...baseSpec,
      servers: [
        {
          url: 'https://example.com/api',
          'x-openweb': { mode: 'browser_fetch', auth: { type: 'cookie_session' } },
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

    const callArgs = evaluateFn.mock.calls[0]![1] as { headers: Record<string, string> }
    expect(callArgs.headers.Cookie).toBeUndefined()
  })
})
