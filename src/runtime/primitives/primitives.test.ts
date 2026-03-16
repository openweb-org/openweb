import { describe, expect, it, vi } from 'vitest'

import { resolveCookieSession } from './cookie-session.js'
import { resolveCookieToHeader } from './cookie-to-header.js'
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

    const result = await resolveCookieSession(handle)
    expect(result.cookieString).toBe('sessionid=abc123; csrftoken=tok456')
    expect(result.headers).toEqual({})
  })

  it('returns empty when no cookies present', async () => {
    const handle = mockHandle([])
    const result = await resolveCookieSession(handle)
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
    })

    expect(result.headers).toEqual({ 'X-CSRFToken': 'tok456' })
    expect(result.cookieString).toBeUndefined()
  })

  it('throws when CSRF cookie is missing', async () => {
    const handle = mockHandle([{ name: 'sessionid', value: 'abc123' }])

    await expect(
      resolveCookieToHeader(handle, { cookie: 'csrftoken', header: 'X-CSRFToken' }),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
  })
})
