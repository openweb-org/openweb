import { describe, expect, it, vi } from 'vitest'

import { resolveSessionStorageMsal } from './sessionstorage-msal.js'
import type { BrowserHandle } from './types.js'

interface StorageSnapshot {
  readonly sessionStorage: Readonly<Record<string, string>>
  readonly localStorage: Readonly<Record<string, string>>
}

function mockHandle(snapshot: StorageSnapshot): BrowserHandle {
  return {
    page: {
      evaluate: vi.fn(async () => snapshot),
    } as unknown as BrowserHandle['page'],
    context: {} as BrowserHandle['context'],
  }
}

function accessTokenEntry(secret: string, target: string, expiresOn = '4102444800'): string {
  return JSON.stringify({
    credentialType: 'AccessToken',
    secret,
    target,
    expiresOn,
  })
}

describe('resolveSessionStorageMsal', () => {
  it('extracts a matching access token from sessionStorage', async () => {
    const handle = mockHandle({
      sessionStorage: {
        'msal.token.keys.client': JSON.stringify({
          accessToken: ['token.graph'],
        }),
        'token.graph': accessTokenEntry('graph-token', 'https://graph.microsoft.com/User.Read'),
      },
      localStorage: {},
    })

    const result = await resolveSessionStorageMsal(handle, {
      key_pattern: 'msal.token.keys.*',
      scope_filter: 'user.read',
      token_field: 'secret',
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    })

    expect(result.headers).toEqual({
      Authorization: 'Bearer graph-token',
    })
  })

  it('falls back to localStorage when sessionStorage has no matching MSAL cache', async () => {
    const handle = mockHandle({
      sessionStorage: {},
      localStorage: {
        'msal.token.keys.client': JSON.stringify({
          accessToken: ['token.graph'],
        }),
        'token.graph': accessTokenEntry('graph-token', 'https://graph.microsoft.com/Files.ReadWrite.All'),
      },
    })

    const result = await resolveSessionStorageMsal(handle, {
      key_pattern: 'msal.token.keys.*',
      scope_filter: 'files.readwrite.all',
      token_field: 'secret',
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    })

    expect(result.headers.Authorization).toBe('Bearer graph-token')
  })

  it('throws needs_login when no token matches the requested scope', async () => {
    const handle = mockHandle({
      sessionStorage: {
        'msal.token.keys.client': JSON.stringify({
          accessToken: ['token.graph'],
        }),
        'token.graph': accessTokenEntry('graph-token', 'https://graph.microsoft.com/User.Read'),
      },
      localStorage: {},
    })

    await expect(
      resolveSessionStorageMsal(handle, {
        key_pattern: 'msal.token.keys.*',
        scope_filter: 'mail.read',
        token_field: 'secret',
        inject: { header: 'Authorization', prefix: 'Bearer ' },
      }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED', failureClass: 'needs_login' },
    })
  })

  it('ignores expired tokens and picks the newest valid candidate', async () => {
    const now = Math.floor(Date.now() / 1000)
    const handle = mockHandle({
      sessionStorage: {
        'msal.token.keys.client': JSON.stringify({
          accessToken: ['token.expired', 'token.valid'],
        }),
        'token.expired': accessTokenEntry('expired-token', 'https://graph.microsoft.com/User.Read', String(now - 60)),
        'token.valid': accessTokenEntry('valid-token', 'https://graph.microsoft.com/User.Read', String(now + 3600)),
      },
      localStorage: {},
    })

    const result = await resolveSessionStorageMsal(handle, {
      key_pattern: 'msal.token.keys.*',
      scope_filter: 'user.read',
      token_field: 'secret',
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    })

    expect(result.headers.Authorization).toBe('Bearer valid-token')
  })

  it('reads direct AccessToken entries and can inject them as query params', async () => {
    const handle = mockHandle({
      sessionStorage: {
        'msal.AccessToken.graph': accessTokenEntry('query-token', 'https://graph.microsoft.com/User.Read'),
      },
      localStorage: {},
    })

    const result = await resolveSessionStorageMsal(handle, {
      key_pattern: 'msal.AccessToken.*',
      scope_filter: 'user.read',
      token_field: 'secret',
      inject: { query: 'access_token' },
    })

    expect(result.headers).toEqual({})
    expect(result.queryParams).toEqual({ access_token: 'query-token' })
  })
})
