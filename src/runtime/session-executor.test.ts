import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import {
  createNeedsPageError,
  findPageForOrigin,
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

function mockBrowser(
  cookies: Array<{ name: string; value: string }>,
  pages: Array<{ url: string; content?: string; evaluateResult?: unknown }> = [
    { url: 'https://www.instagram.com', content: '<html><body>ready</body></html>' },
  ],
) {
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
        pages: () => pages.map((page) => ({
          url: () => page.url,
          content: vi.fn(async () => page.content ?? '<html><body>ready</body></html>'),
          evaluate: vi.fn(async () => page.evaluateResult),
        })),
      },
    ],
    close: vi.fn(async () => {}),
  } as unknown as import('playwright').Browser
}

describe('findPageForOrigin', () => {
  it('ignores worker-like and empty-content pages when matching the site tab', async () => {
    const context = {
      pages: () => [
        {
          url: () => 'https://www.youtube.com/sw.js',
          content: vi.fn(async () => '<html><body>worker</body></html>'),
        },
        {
          url: () => 'https://www.youtube.com',
          content: vi.fn(async () => ''),
        },
        {
          url: () => 'https://www.youtube.com/watch?v=123',
          content: vi.fn(async () => '<html><body>video</body></html>'),
        },
      ],
    } as unknown as import('playwright').BrowserContext

    const page = await findPageForOrigin(context, 'https://www.youtube.com/youtubei/v1')

    expect(page?.url()).toBe('https://www.youtube.com/watch?v=123')
  })

  it('returns undefined when no real page matches the target origin', async () => {
    const context = {
      pages: () => [
        {
          url: () => 'https://www.youtube.com/sw.js',
          content: vi.fn(async () => '<html><body>worker</body></html>'),
        },
        {
          url: () => 'https://example.com',
          content: vi.fn(async () => '<html><body>other</body></html>'),
        },
      ],
    } as unknown as import('playwright').BrowserContext

    const page = await findPageForOrigin(context, 'https://www.youtube.com/youtubei/v1')

    expect(page).toBeUndefined()
  })
})

describe('createNeedsPageError', () => {
  it('suggests the web app origin instead of the API origin', () => {
    const error = createNeedsPageError('https://api.github.com')

    expect(error.payload.action).toContain('https://github.com/')
  })
})

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

  it('throws needs_page when a browser exists but no matching site tab is open', async () => {
    const browser = mockBrowser(
      [
        { name: 'sessionid', value: 'sess_abc' },
        { name: 'csrftoken', value: 'csrf_xyz' },
      ],
      [
        { url: 'https://www.youtube.com/sw.js', content: '<html><body>worker</body></html>' },
        { url: 'https://example.com', content: '<html><body>other</body></html>' },
      ],
    )

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
      payload: {
        failureClass: 'needs_page',
        action: expect.stringContaining('https://www.instagram.com/'),
      },
    })
  })

  it('applies query defaults before building the request URL', async () => {
    const browser = mockBrowser([], [
      { url: 'https://github.com/openai/openai-node', content: '<html><body>repo</body></html>' },
    ])
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'GitHub API', version: '1.0' },
      servers: [
        {
          url: 'https://api.github.com',
          'x-openweb': {
            mode: 'session_http',
          },
        } as unknown as { url: string },
      ],
      paths: {
        '/repos/{owner}/{repo}/issues': {
          get: {
            operationId: 'listIssues',
            parameters: [
              { name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'per_page', in: 'query', schema: { type: 'integer', default: 30 } },
            ],
            responses: { '200': { content: { 'application/json': { schema: { type: 'array' } } } } },
          },
        },
      },
    }

    await executeSessionHttp(
      browser,
      spec,
      '/repos/{owner}/{repo}/issues',
      'get',
      spec.paths!['/repos/{owner}/{repo}/issues']!.get!,
      { owner: 'openai', repo: 'openai-node' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain('per_page=30')
  })

  it('maps HTTP 401 to needs_login instead of fatal', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: {
        message: 'HTTP 401',
        failureClass: 'needs_login',
        retriable: true,
      },
    })
  })

  it('allows auth-injected query params to satisfy required query validation', async () => {
    const browser = mockBrowser([], [
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        content: '<html><body>youtube</body></html>',
        evaluateResult: 'yt_api_key_123',
      },
    ])
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'YouTube', version: '1.0' },
      servers: [
        {
          url: 'https://www.youtube.com/youtubei/v1',
          'x-openweb': {
            mode: 'session_http',
            auth: {
              type: 'page_global',
              expression: 'ytcfg.data_.INNERTUBE_API_KEY',
              inject: { query: 'key' },
            },
          },
        } as unknown as { url: string },
      ],
      paths: {
        '/player': {
          post: {
            operationId: 'getVideoInfo',
            parameters: [
              { name: 'key', in: 'query', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      videoId: { type: 'string' },
                      context: {
                        type: 'object',
                        default: {
                          client: {
                            clientName: 'WEB',
                            clientVersion: '2.20260316.01.00',
                            hl: 'en',
                            gl: 'US',
                          },
                        },
                      },
                    },
                    required: ['videoId'],
                  },
                },
              },
            },
            responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      },
    }

    await executeSessionHttp(
      browser,
      spec,
      '/player',
      'post',
      spec.paths!['/player']!.post!,
      { videoId: 'dQw4w9WgXcQ' },
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    expect(String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain('key=yt_api_key_123')
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.body).toBe(
      JSON.stringify({
        videoId: 'dQw4w9WgXcQ',
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20260316.01.00',
            hl: 'en',
            gl: 'US',
          },
        },
      }),
    )
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

  it('sends an empty JSON object when requestBody is required but has no explicit fields', async () => {
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

    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
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
        '/required-body/': {
          post: {
            operationId: 'requiredBody',
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
            responses: {
              '200': {
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    }

    await executeSessionHttp(
      browser,
      spec,
      '/required-body/',
      'post',
      spec.paths!['/required-body/']!.post!,
      {},
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    expect(calledInit.body).toBe('{}')
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

  // CR-15: Redirect tests
  it('follows 301 redirect to the final URL', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { location: 'https://www.instagram.com/api/v1/feed/new-timeline/' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

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
    expect(result.body).toEqual({ ok: true })

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(String(calls[1]![0])).toBe('https://www.instagram.com/api/v1/feed/new-timeline/')
  })

  it('switches method to GET on 303 redirect', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 303,
        headers: { location: 'https://www.instagram.com/api/v1/result/' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

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

    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect((calls[0]![1] as RequestInit).method).toBe('POST')
    expect((calls[1]![1] as RequestInit).method).toBe('GET')
  })

  it('strips sensitive headers on cross-origin redirect', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    // Capture headers snapshots at each call to verify mutation
    const capturedHeaders: Record<string, string>[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders.push({ ...(init.headers as Record<string, string>) })
      if (capturedHeaders.length === 1) {
        return new Response('', {
          status: 301,
          headers: { location: 'https://other-domain.com/callback' },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

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

    expect(capturedHeaders).toHaveLength(2)

    // First call should have Cookie (same-origin)
    expect(capturedHeaders[0]!.Cookie).toBeDefined()

    // Second call (cross-origin) should NOT have Cookie or Authorization
    expect(capturedHeaders[1]!.Cookie).toBeUndefined()
    expect(capturedHeaders[1]!.Authorization).toBeUndefined()
  })

  it('throws an explicit error when Location header is missing', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 301 })) as unknown as typeof fetch

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('missing Location header') },
    })

    // Fetch should only be called once (no infinite loop)
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('allows MAX_REDIRECTS redirects before succeeding', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount += 1
      if (callCount <= 5) {
        return new Response('', {
          status: 301,
          headers: { location: `https://www.instagram.com/api/v1/redirect/${callCount}/` },
        })
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

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
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6)
  })

  it('throws "Too many redirects" after exceeding MAX_REDIRECTS', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount++
      return new Response('', {
        status: 301,
        headers: { location: `https://www.instagram.com/api/v1/redirect/${callCount}/` },
      })
    }) as unknown as typeof fetch

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('Too many redirects') },
    })

    // MAX_REDIRECTS is 5, so the executor follows up to 5 redirects and fails on the 6th redirect response.
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(6)
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

  // CR-16: SSRF failure test
  it('does not call fetch when ssrfValidator rejects', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn() as unknown as typeof fetch
    const ssrfValidator = vi.fn(async () => {
      throw new Error('SSRF blocked: private IP')
    })

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: fetchMock, ssrfValidator },
      ),
    ).rejects.toThrow('SSRF blocked: private IP')

    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  // CR-17: $ref resolution tests
  it('resolves valid $ref parameters correctly', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [
        {
          url: 'https://www.instagram.com/api/v1',
          'x-openweb': {
            mode: 'session_http',
            auth: { type: 'cookie_session' },
          },
        } as unknown as { url: string },
      ],
      paths: {
        '/feed/timeline/': {
          get: {
            operationId: 'getTimeline',
            parameters: [
              { $ref: '#/components/parameters/AppID' } as unknown as OpenApiParameter,
            ],
            responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      },
      components: {
        parameters: {
          AppID: { name: 'X-IG-App-ID', in: 'header', required: true, schema: { type: 'string', default: '936619743392459' } },
        },
      },
    } as unknown as OpenApiSpec

    await executeSessionHttp(
      browser,
      spec,
      '/feed/timeline/',
      'get',
      spec.paths!['/feed/timeline/']!.get!,
      {},
      { fetchImpl: fetchMock, ssrfValidator: async () => {} },
    )

    const calledInit = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit
    const headers = calledInit.headers as Record<string, string>
    expect(headers['X-IG-App-ID']).toBe('936619743392459')
  })

  it('drops parameter when $ref target is missing', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [
        {
          url: 'https://www.instagram.com/api/v1',
          'x-openweb': {
            mode: 'session_http',
            auth: { type: 'cookie_session' },
          },
        } as unknown as { url: string },
      ],
      paths: {
        '/feed/timeline/': {
          get: {
            operationId: 'getTimeline',
            parameters: [
              { $ref: '#/components/parameters/NonExistent' } as unknown as OpenApiParameter,
            ],
            responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      },
      // No components defined — $ref target missing
    } as unknown as OpenApiSpec

    // Should not throw — missing $ref is silently dropped
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
    // Verify fetch was called (parameter was dropped, not crashed)
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('drops parameter when $ref path contains __proto__', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const spec: OpenApiSpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0' },
      servers: [
        {
          url: 'https://www.instagram.com/api/v1',
          'x-openweb': {
            mode: 'session_http',
            auth: { type: 'cookie_session' },
          },
        } as unknown as { url: string },
      ],
      paths: {
        '/feed/timeline/': {
          get: {
            operationId: 'getTimeline',
            parameters: [
              { $ref: '#/__proto__/polluted' } as unknown as OpenApiParameter,
            ],
            responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
          },
        },
      },
    } as unknown as OpenApiSpec

    // Should not throw — __proto__ ref is silently dropped
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
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  // CR-18: Non-JSON response test
  it('throws OpenWebError when response is not valid JSON', async () => {
    const browser = mockBrowser([
      { name: 'sessionid', value: 'sess_abc' },
      { name: 'csrftoken', value: 'csrf_xyz' },
    ])

    const fetchMock = vi.fn(async () =>
      new Response('<html><body>Not Found</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ) as unknown as typeof fetch

    const spec = instagramSpec()
    await expect(
      executeSessionHttp(
        browser,
        spec,
        '/feed/timeline/',
        'get',
        spec.paths!['/feed/timeline/']!.get!,
        {},
        { fetchImpl: fetchMock, ssrfValidator: async () => {} },
      ),
    ).rejects.toMatchObject({
      payload: { message: expect.stringContaining('not valid JSON') },
    })
  })
})
