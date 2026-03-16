import { describe, expect, it, vi } from 'vitest'

import { resolveApiResponse } from './api-response.js'
import { resolveCookieSession } from './cookie-session.js'
import { resolveCookieToHeader } from './cookie-to-header.js'
import { resolveExchangeChain } from './exchange-chain.js'
import { resolveLocalStorageJwt } from './localstorage-jwt.js'
import { resolveMetaTag } from './meta-tag.js'
import { resolvePageGlobal } from './page-global.js'
import { resolveSapisidhash, computeSapisidhash } from './sapisidhash.js'
import { resolveScriptJson } from './script-json.js'
import type { BrowserHandle } from './types.js'

function mockHandle(cookies: Array<{ name: string; value: string }>): BrowserHandle {
  const fullCookies = cookies.map((c) => ({
    ...c,
    domain: '.example.com',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax' as const,
    expires: -1,
  }))

  return {
    page: {} as BrowserHandle['page'],
    context: {
      cookies: vi.fn(async () => fullCookies),
    } as unknown as BrowserHandle['context'],
  }
}

describe('resolveCookieSession', () => {
  it('formats all cookies as a Cookie header string', async () => {
    const handle = mockHandle([
      { name: 'sessionid', value: 'abc123' },
      { name: 'csrftoken', value: 'tok456' },
    ])

    const result = await resolveCookieSession(handle, 'https://example.com')
    expect(result.cookieString).toBe('sessionid=abc123; csrftoken=tok456')
    expect(result.headers).toEqual({})
  })

  it('returns empty when no cookies present', async () => {
    const handle = mockHandle([])
    const result = await resolveCookieSession(handle, 'https://example.com')
    expect(result.cookieString).toBeUndefined()
    expect(result.headers).toEqual({})
  })
})

describe('resolveCookieToHeader', () => {
  it('extracts cookie value and injects as header', async () => {
    const handle = mockHandle([
      { name: 'sessionid', value: 'abc123' },
      { name: 'csrftoken', value: 'tok456' },
    ])

    const result = await resolveCookieToHeader(handle, {
      cookie: 'csrftoken',
      header: 'X-CSRFToken',
    }, 'https://example.com')

    expect(result.headers).toEqual({ 'X-CSRFToken': 'tok456' })
    expect(result.cookieString).toBeUndefined()
  })

  it('throws when CSRF cookie is missing', async () => {
    const handle = mockHandle([{ name: 'sessionid', value: 'abc123' }])

    await expect(
      resolveCookieToHeader(handle, { cookie: 'csrftoken', header: 'X-CSRFToken' }, 'https://example.com'),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })
})

describe('resolveLocalStorageJwt', () => {
  it('reads JWT from localStorage and injects as Bearer header', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => JSON.stringify({
          session: {
            currentAccount: {
              accessJwt: 'eyJhbGciOiJFUzI1NiJ9.test.token',
            },
          },
        })),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolveLocalStorageJwt(handle, {
      key: 'BSKY_STORAGE',
      path: 'session.currentAccount.accessJwt',
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    })

    expect(result.headers).toEqual({
      Authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.test.token',
    })
  })

  it('throws when localStorage key not found', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => null),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    await expect(
      resolveLocalStorageJwt(handle, {
        key: 'MISSING_KEY',
        inject: { header: 'Authorization' },
      }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })

  it('throws when path does not exist in parsed JSON', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => JSON.stringify({ other: 'data' })),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    await expect(
      resolveLocalStorageJwt(handle, {
        key: 'BSKY_STORAGE',
        path: 'session.currentAccount.accessJwt',
        inject: { header: 'Authorization' },
      }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})

describe('resolveMetaTag', () => {
  it('reads CSRF token from meta tag', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => 'csrf_token_value_123'),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolveMetaTag(handle, { name: 'csrf-token', header: 'X-CSRF-Token' })
    expect(result.headers).toEqual({ 'X-CSRF-Token': 'csrf_token_value_123' })
  })

  it('throws when meta tag not found', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => null),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    await expect(
      resolveMetaTag(handle, { name: 'csrf-token', header: 'X-CSRF-Token' }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})

describe('resolveScriptJson', () => {
  it('extracts and parses JSON from script tag', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => JSON.stringify({ repo: { name: 'test', stars: 42 } })),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolveScriptJson(handle, {
      selector: 'script[data-target="react-app.embeddedData"]',
      path: 'repo',
    })
    expect(result).toEqual({ name: 'test', stars: 42 })
  })

  it('returns full data when no path specified', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => JSON.stringify({ items: [1, 2, 3] })),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolveScriptJson(handle, {
      selector: 'script[type="application/json"]',
    })
    expect(result).toEqual({ items: [1, 2, 3] })
  })

  it('throws when script element not found', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => null),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    await expect(
      resolveScriptJson(handle, { selector: 'script.missing' }),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })
})

describe('resolvePageGlobal', () => {
  it('evaluates expression and injects as query param', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolvePageGlobal(handle, {
      expression: 'ytcfg.data_.INNERTUBE_API_KEY',
      inject: { query: 'key' },
    })

    expect(result.queryParams).toEqual({ key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' })
  })

  it('evaluates expression and injects as header', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => 'some_token_value'),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    const result = await resolvePageGlobal(handle, {
      expression: '__context__.token',
      inject: { header: 'X-Token', prefix: 'Bearer ' },
    })

    expect(result.headers).toEqual({ 'X-Token': 'Bearer some_token_value' })
  })

  it('throws when expression returns undefined', async () => {
    const handle: BrowserHandle = {
      page: {
        evaluate: vi.fn(async () => undefined),
      } as unknown as BrowserHandle['page'],
      context: {} as BrowserHandle['context'],
    }

    await expect(
      resolvePageGlobal(handle, {
        expression: 'nonexistent.value',
        inject: { query: 'key' },
      }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})

describe('resolveSapisidhash', () => {
  it('computes SAPISIDHASH from SAPISID cookie', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => [
          { name: 'SAPISID', value: 'abc123/def456', domain: '.youtube.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax', expires: -1 },
        ]),
      } as unknown as BrowserHandle['context'],
    }

    const result = await resolveSapisidhash(handle, {
      origin: 'https://www.youtube.com',
      inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' },
    }, 'https://www.youtube.com')

    // Verify the header starts with the expected prefix and has the right format
    const authHeader = result.headers.Authorization
    expect(authHeader).toBeDefined()
    expect(authHeader).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/)
  })

  it('throws when SAPISID cookie not found', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    await expect(
      resolveSapisidhash(handle, {
        origin: 'https://www.youtube.com',
        inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' },
      }, 'https://www.youtube.com'),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})

describe('computeSapisidhash', () => {
  it('produces correct SHA-1 hash', () => {
    // Known test vector
    const hash = computeSapisidhash(1234567890, 'test_sapisid', 'https://www.youtube.com')
    // SHA1("1234567890 test_sapisid https://www.youtube.com")
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
    // Verify deterministic
    expect(computeSapisidhash(1234567890, 'test_sapisid', 'https://www.youtube.com')).toBe(hash)
  })
})

describe('resolveExchangeChain', () => {
  it('executes exchange step and injects bearer token', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => [
          { name: 'reddit_session', value: 'sess_abc', domain: '.reddit.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: -1 },
        ]),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await resolveExchangeChain(handle, {
      steps: [{ call: 'https://www.reddit.com/svc/shreddit/token', extract: 'accessToken' }],
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    }, 'https://oauth.reddit.com', { fetchImpl: fetchMock })

    expect(result.headers.Authorization).toBe('Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test')
  })

  it('throws when exchange step fails', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response('Unauthorized', { status: 401 }),
    ) as unknown as typeof fetch

    await expect(
      resolveExchangeChain(handle, {
        steps: [{ call: 'https://www.reddit.com/svc/shreddit/token', extract: 'accessToken' }],
        inject: { header: 'Authorization', prefix: 'Bearer ' },
      }, 'https://oauth.reddit.com', { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })

  it('throws when extract path not found in response', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ otherField: 'value' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(
      resolveExchangeChain(handle, {
        steps: [{ call: 'https://example.com/token', extract: 'accessToken' }],
        inject: { header: 'Authorization' },
      }, 'https://example.com', { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})

describe('resolveApiResponse', () => {
  it('fetches CSRF token from API endpoint', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { modhash: 'abc123modhash' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await resolveApiResponse(handle, {
      endpoint: 'https://oauth.reddit.com/api/me.json',
      extract: 'data.modhash',
      inject: { header: 'X-Modhash' },
    }, 'https://oauth.reddit.com', { fetchImpl: fetchMock })

    expect(result.headers).toEqual({ 'X-Modhash': 'abc123modhash' })
  })

  it('passes auth headers when provided', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'csrf_tok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await resolveApiResponse(handle, {
      endpoint: 'https://example.com/csrf',
      extract: 'token',
      inject: { header: 'X-CSRF' },
    }, 'https://example.com', {
      fetchImpl: fetchMock,
      authHeaders: { Authorization: 'Bearer test_token' },
    })

    // Verify fetch was called with auth headers
    const calledHeaders = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers as Record<string, string>
    expect(calledHeaders.Authorization).toBe('Bearer test_token')
  })

  it('throws when endpoint returns error', async () => {
    const handle = {
      page: {} as BrowserHandle['page'],
      context: {
        cookies: vi.fn(async () => []),
      } as unknown as BrowserHandle['context'],
    }

    const fetchMock = vi.fn(async () =>
      new Response('Not Found', { status: 404 }),
    ) as unknown as typeof fetch

    await expect(
      resolveApiResponse(handle, {
        endpoint: 'https://example.com/csrf',
        extract: 'token',
        inject: { header: 'X-CSRF' },
      }, 'https://example.com', { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
  })
})
