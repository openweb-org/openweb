import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { executeOperation } from '../../src/runtime/executor.js'
import type { PermissionsConfig } from '../../src/lib/permissions.js'

const ALL_ALLOW: PermissionsConfig = {
  defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' },
}

const TOKEN_CACHE_DIR = mkdtempSync(join(tmpdir(), 'openweb-test-tokens-'))

/**
 * Create a mock browser that simulates an already-logged-in Instagram session.
 * Cookies: sessionid + csrftoken. Page URL: instagram.com.
 */
function mockInstagramBrowser() {
  const cookies = [
    { name: 'sessionid', value: 'sess_test_123', domain: '.instagram.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' as const, expires: -1 },
    { name: 'csrftoken', value: 'csrf_test_abc', domain: '.instagram.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' as const, expires: -1 },
    { name: 'ig_did', value: 'device_id_xyz', domain: '.instagram.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' as const, expires: -1 },
  ]

  return {
    contexts: () => [
      {
        cookies: vi.fn(async () => cookies),
        pages: () => [{
          url: () => 'https://www.instagram.com',
          content: vi.fn(async () => '<html><body>instagram</body></html>'),
        }],
      },
    ],
    close: vi.fn(async () => {}),
  } as unknown as import('playwright').Browser
}

describe('executeOperation with instagram-fixture (node transport)', () => {
  it('executes getTimeline with cookie auth and header params', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          feed_items: [{ id: '1', caption: { text: 'hello' } }],
          next_max_id: 'cursor_123',
          more_available: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation(
      'instagram-fixture',
      'getTimeline',
      {},
      {
        browser: mockInstagramBrowser(),
        fetchImpl: fetchMock,
        ssrfValidator: async () => {},
        tokenCacheDir: TOKEN_CACHE_DIR,
      },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
    expect((result.body as Record<string, unknown>).feed_items).toBeInstanceOf(Array)

    // Verify the fetch was called with correct URL and headers
    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledUrl = String(calledArgs[0])
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    expect(calledUrl).toContain('https://www.instagram.com/api/v1/feed/timeline/')
    expect(headers['X-IG-App-ID']).toBe('936619743392459')
    expect(headers.Cookie).toContain('sessionid=sess_test_123')
    expect(headers.Cookie).toContain('csrftoken=csrf_test_abc')
    // GET request — no CSRF header
    expect(headers['X-CSRFToken']).toBeUndefined()
  })

  it('executes getUserProfile with path parameter substitution', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ user: { pk: '42', username: 'testuser', full_name: 'Test User' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation(
      'instagram-fixture',
      'getUserProfile',
      { user_id: '42' },
      {
        browser: mockInstagramBrowser(),
        fetchImpl: fetchMock,
        ssrfValidator: async () => {},
        tokenCacheDir: TOKEN_CACHE_DIR,
      },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)

    const calledUrl = String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(calledUrl).toContain('/users/42/info/')
  })

  it('executes likeMedia (POST) with CSRF header injected', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: 'ok' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation(
      'instagram-fixture',
      'likeMedia',
      { media_id: '999' },
      {
        browser: mockInstagramBrowser(),
        fetchImpl: fetchMock,
        ssrfValidator: async () => {},
        permissionsConfig: ALL_ALLOW,
        tokenCacheDir: TOKEN_CACHE_DIR,
      },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)

    const calledArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
    const calledUrl = String(calledArgs[0])
    const calledInit = calledArgs[1] as RequestInit
    const headers = calledInit.headers as Record<string, string>

    expect(calledUrl).toContain('/media/999/like/')
    // POST: CSRF header SHOULD be present
    expect(headers['X-CSRFToken']).toBe('csrf_test_abc')
    expect(headers.Cookie).toContain('sessionid=sess_test_123')
    expect(calledInit.method).toBe('POST')
  })

  it('schema validation passes for conforming response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ feed_items: [{ id: '1' }], next_max_id: 'abc', more_available: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation(
      'instagram-fixture',
      'getTimeline',
      {},
      {
        browser: mockInstagramBrowser(),
        fetchImpl: fetchMock,
        ssrfValidator: async () => {},
        tokenCacheDir: TOKEN_CACHE_DIR,
      },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
  })
})

describe('node transport regression', () => {
  it('open-meteo-fixture still works via node transport path', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ name: 'Berlin', latitude: 52.52, longitude: 13.41 }],
          generationtime_ms: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const result = await executeOperation(
      'open-meteo-fixture',
      'search_location',
      { name: 'Berlin', count: 1 },
      { fetchImpl: fetchMock, ssrfValidator: async () => {}, tokenCacheDir: TOKEN_CACHE_DIR },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)

    const calledUrl = String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![0])
    expect(calledUrl).toContain('https://geocoding-api.open-meteo.com/v1/search')
  })
})
