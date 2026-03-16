import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import {
  resolveMode,
  substitutePath,
  buildHeaderParams,
  getServerXOpenWeb,
  executeSessionHttp,
} from './session-executor.js'
import type { OpenApiSpec, OpenApiOperation, OpenApiParameter } from '../lib/openapi.js'

function instagramSpec(): OpenApiSpec {
  return {
    openapi: '3.1.0',
    info: { title: 'Instagram API', version: '1.0' },
    servers: [
      {
        url: 'https://www.instagram.com/api/v1',
        'x-openweb': {
          mode: 'session_http',
          auth: { type: 'cookie_session' },
          csrf: { type: 'cookie_to_header', cookie: 'csrftoken', header: 'X-CSRFToken' },
        },
      } as unknown as { url: string },
    ],
    paths: {
      '/feed/timeline/': {
        get: {
          operationId: 'getTimeline',
          summary: 'Get timeline',
          'x-openweb': { risk_tier: 'safe' },
          parameters: [
            { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
          ],
          responses: {
            '200': {
              content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array' } } } } },
            },
          },
        },
      },
      '/media/{media_id}/like/': {
        post: {
          operationId: 'likeMedia',
          summary: 'Like a media post',
          'x-openweb': { risk_tier: 'medium' },
          parameters: [
            { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
            { name: 'media_id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } },
            },
          },
        },
      },
      '/media/{media_id}/comment/': {
        post: {
          operationId: 'commentMedia',
          summary: 'Comment on a media post',
          'x-openweb': { risk_tier: 'medium' },
          parameters: [
            { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
            { name: 'media_id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { comment_text: { type: 'string' } } } } },
          },
          responses: {
            '200': {
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } },
            },
          },
        },
      },
    },
  }
}

describe('resolveMode', () => {
  it('reads mode from server-level x-openweb', () => {
    const spec = instagramSpec()
    const op = spec.paths!['/feed/timeline/']!.get!
    expect(resolveMode(spec, op)).toBe('session_http')
  })

  it('defaults to direct_http when no x-openweb', () => {
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: { '/test': { get: { operationId: 'test' } } },
    }
    expect(resolveMode(spec, spec.paths!['/test']!.get!)).toBe('direct_http')
  })
})

describe('substitutePath', () => {
  it('replaces path parameters', () => {
    const params: OpenApiParameter[] = [{ name: 'media_id', in: 'path', required: true, schema: { type: 'string' } }]
    expect(substitutePath('/media/{media_id}/like/', params, { media_id: '12345' })).toBe('/media/12345/like/')
  })

  it('throws when required path param is missing', () => {
    const params: OpenApiParameter[] = [{ name: 'media_id', in: 'path', required: true, schema: { type: 'string' } }]
    expect(() => substitutePath('/media/{media_id}/like/', params, {})).toThrow(OpenWebError)
  })
})

describe('buildHeaderParams', () => {
  it('uses default values from schema', () => {
    const params: OpenApiParameter[] = [
      { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
    ]
    expect(buildHeaderParams(params, {})).toEqual({ 'X-IG-App-ID': '936619743392459' })
  })

  it('user-provided value overrides default', () => {
    const params: OpenApiParameter[] = [
      { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
    ]
    expect(buildHeaderParams(params, { 'X-IG-App-ID': 'custom' })).toEqual({ 'X-IG-App-ID': 'custom' })
  })
})

describe('getServerXOpenWeb', () => {
  it('returns server x-openweb config', () => {
    const spec = instagramSpec()
    const op = spec.paths!['/feed/timeline/']!.get!
    const ext = getServerXOpenWeb(spec, op)
    expect(ext?.mode).toBe('session_http')
    expect(ext?.auth).toEqual({ type: 'cookie_session' })
    expect(ext?.csrf).toEqual({ type: 'cookie_to_header', cookie: 'csrftoken', header: 'X-CSRFToken' })
  })
})

function mockBrowser(cookies: Array<{ name: string; value: string }>) {
  const fullCookies = cookies.map((c) => ({
    ...c,
    domain: '.instagram.com',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax' as const,
    expires: -1,
  }))

  return {
    contexts: () => [
      {
        cookies: vi.fn(async () => fullCookies),
        pages: () => [{ url: () => 'https://www.instagram.com' }],
      },
    ],
    close: vi.fn(async () => {}),
  } as unknown as import('playwright').Browser
}

describe('executeSessionHttp', () => {
  it('injects cookies and header params for GET request', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], next_max_id: null, more_available: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    const result = await executeSessionHttp(
      browser,
      spec,
      '/feed/timeline/',
      'get',
      spec.paths!['/feed/timeline/']!.get!,
      {},
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(result.status).toBe(200)

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledUrl = String(calledArgs[0])
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    expect(calledUrl).toContain('https://www.instagram.com/api/v1/feed/timeline/')
    expect(headers['X-IG-App-ID']).toBe('936619743392459')
    expect(headers.Cookie).toBe('sessionid=sess_abc; csrftoken=csrf_xyz')
    // GET request: no CSRF header
    expect(headers['X-CSRFToken']).toBeUndefined()
  })

  it('injects CSRF header for POST (mutation) request', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    const result = await executeSessionHttp(
      browser,
      spec,
      '/media/{media_id}/like/',
      'post',
      spec.paths!['/media/{media_id}/like/']!.post!,
      { media_id: '99999' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(result.status).toBe(200)

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledUrl = String(calledArgs[0])
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    // Path parameter substituted
    expect(calledUrl).toContain('/media/99999/like/')
    // CSRF header present for POST
    expect(headers['X-CSRFToken']).toBe('csrf_xyz')
    expect(headers.Cookie).toBe('sessionid=sess_abc; csrftoken=csrf_xyz')
  })

  it('throws when no browser context available', async () => {
    const browser = {
      contexts: () => [],
      close: vi.fn(async () => {}),
    } as unknown as import('playwright').Browser

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: vi.fn() as unknown as typeof fetch, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })

  it('sends JSON body with non-path/query/header params on POST', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    const result = await executeSessionHttp(
      browser,
      spec,
      '/media/{media_id}/comment/',
      'post',
      spec.paths!['/media/{media_id}/comment/']!.post!,
      { media_id: '99999', comment_text: 'Great photo!' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(result.status).toBe(200)

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    // Body contains only the non-path/header param
    expect(calledInit.body).toBe(JSON.stringify({ comment_text: 'Great photo!' }))
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('does NOT send body when POST has no leftover params', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    await executeSessionHttp(
      browser,
      spec,
      '/media/{media_id}/like/',
      'post',
      spec.paths!['/media/{media_id}/like/']!.post!,
      { media_id: '99999' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    // No leftover params → no body, no Content-Type
    expect(calledInit.body).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('does NOT send body for GET requests', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    await executeSessionHttp(
      browser,
      spec,
      '/feed/timeline/',
      'get',
      spec.paths!['/feed/timeline/']!.get!,
      {},
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledInit = calledArgs[1] as RequestInit

    expect(calledInit.body).toBeUndefined()
  })

  it('drops body on 303 redirect', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        // First call: 303 redirect
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.instagram.com/api/v1/media/99999/comment/result/' },
        })
      }
      // Second call: final response after redirect
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const spec = instagramSpec()
    await executeSessionHttp(
      browser,
      spec,
      '/media/{media_id}/comment/',
      'post',
      spec.paths!['/media/{media_id}/comment/']!.post!,
      { media_id: '99999', comment_text: 'Great photo!' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls

    // First call: POST with body
    const firstInit = calls[0]![1] as RequestInit
    expect(firstInit.method).toBe('POST')
    expect(firstInit.body).toBe(JSON.stringify({ comment_text: 'Great photo!' }))

    // Second call: GET without body (303 redirect)
    const secondInit = calls[1]![1] as RequestInit
    expect(secondInit.method).toBe('GET')
    expect(secondInit.body).toBeUndefined()
  })
})
