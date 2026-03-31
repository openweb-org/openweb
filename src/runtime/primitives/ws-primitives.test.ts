import { describe, expect, it, vi } from 'vitest'

import type { WsAuthConfig, WsFirstMessage, WsHttpHandshake, WsUpgradeHeader, WsUrlToken } from '../../types/ws-primitives.js'
import { resolveWsFirstMessage } from './ws-first-message.js'
import { resolveWsHttpHandshake } from './ws-http-handshake.js'
import { getWsResolver, resolveWsAuth } from './ws-registry.js'
import type { WsResolverContext } from './ws-registry.js'
import { resolveWsUpgradeHeader } from './ws-upgrade-header.js'
import { resolveWsUrlToken } from './ws-url-token.js'

// ── ws_upgrade_header ────────────────────────────

describe('resolveWsUpgradeHeader', () => {
  const config: WsUpgradeHeader = {
    type: 'ws_upgrade_header',
    inject: { header: 'Authorization', prefix: 'Bearer ' },
  }

  it('injects token as upgrade header', () => {
    const ctx: WsResolverContext = {
      url: 'wss://example.com/ws',
      params: { token: 'my-token' },
    }
    const result = resolveWsUpgradeHeader(config, ctx)
    expect(result).toEqual({ type: 'headers', headers: { Authorization: 'Bearer my-token' } })
  })

  it('prefers httpAuth token over params', () => {
    const ctx: WsResolverContext = {
      url: 'wss://example.com/ws',
      params: { token: 'param-token' },
      httpAuth: { token: 'http-token' },
    }
    const result = resolveWsUpgradeHeader(config, ctx)
    expect(result).toEqual({ type: 'headers', headers: { Authorization: 'Bearer http-token' } })
  })

  it('defaults header name to Authorization', () => {
    const noHeaderConfig: WsUpgradeHeader = {
      type: 'ws_upgrade_header',
      inject: { prefix: 'Token ' },
    }
    const ctx: WsResolverContext = { url: 'wss://example.com/ws', params: { token: 'abc' } }
    const result = resolveWsUpgradeHeader(noHeaderConfig, ctx)
    expect(result).toEqual({ type: 'headers', headers: { Authorization: 'Token abc' } })
  })

  it('throws when no token available', () => {
    const ctx: WsResolverContext = { url: 'wss://example.com/ws', params: {} }
    expect(() => resolveWsUpgradeHeader(config, ctx)).toThrow('No token available')
  })
})

// ── ws_first_message ─────────────────────────────

describe('resolveWsFirstMessage', () => {
  const config: WsFirstMessage = {
    type: 'ws_first_message',
    discriminator: { op: 2 },
    token_path: 'd.token',
    token_source: 'param',
  }

  it('builds auth message with discriminator and token', () => {
    const ctx: WsResolverContext = { url: 'wss://gateway.discord.gg', params: { token: 'bot-token' } }
    const result = resolveWsFirstMessage(config, ctx)
    expect(result).toEqual({
      type: 'first_message',
      payload: { op: 2, d: { token: 'bot-token' } },
    })
  })

  it('uses httpAuth token when token_source is http_auth', () => {
    const httpConfig: WsFirstMessage = { ...config, token_source: 'http_auth' }
    const ctx: WsResolverContext = {
      url: 'wss://example.com/ws',
      params: {},
      httpAuth: { token: 'resolved-token' },
    }
    const result = resolveWsFirstMessage(httpConfig, ctx)
    expect(result.type).toBe('first_message')
    expect((result as { payload: Record<string, unknown> }).payload).toEqual({
      op: 2,
      d: { token: 'resolved-token' },
    })
  })

  it('throws when no token for param source', () => {
    const ctx: WsResolverContext = { url: 'wss://example.com/ws', params: {} }
    expect(() => resolveWsFirstMessage(config, ctx)).toThrow('No token available')
  })

  it('throws when no token for http_auth source', () => {
    const httpConfig: WsFirstMessage = { ...config, token_source: 'http_auth' }
    const ctx: WsResolverContext = { url: 'wss://example.com/ws', params: {}, httpAuth: {} }
    expect(() => resolveWsFirstMessage(httpConfig, ctx)).toThrow('No token available')
  })
})

// ── ws_url_token ─────────────────────────────────

describe('resolveWsUrlToken', () => {
  const config: WsUrlToken = {
    type: 'ws_url_token',
    param: 'access_token',
    token_source: 'param',
  }

  it('appends token as query param to URL', () => {
    const ctx: WsResolverContext = { url: 'wss://stream.example.com/v1', params: { token: 'abc123' } }
    const result = resolveWsUrlToken(config, ctx)
    expect(result.type).toBe('url')
    const url = new URL((result as { url: string }).url)
    expect(url.searchParams.get('access_token')).toBe('abc123')
    expect(url.hostname).toBe('stream.example.com')
  })

  it('preserves existing query params', () => {
    const ctx: WsResolverContext = {
      url: 'wss://stream.example.com/v1?encoding=json',
      params: { token: 'xyz' },
    }
    const result = resolveWsUrlToken(config, ctx)
    const url = new URL((result as { url: string }).url)
    expect(url.searchParams.get('encoding')).toBe('json')
    expect(url.searchParams.get('access_token')).toBe('xyz')
  })

  it('uses httpAuth token when token_source is http_auth', () => {
    const httpConfig: WsUrlToken = { ...config, token_source: 'http_auth' }
    const ctx: WsResolverContext = {
      url: 'wss://example.com/ws',
      params: {},
      httpAuth: { token: 'http-tok' },
    }
    const result = resolveWsUrlToken(httpConfig, ctx)
    const url = new URL((result as { url: string }).url)
    expect(url.searchParams.get('access_token')).toBe('http-tok')
  })

  it('throws when no token available', () => {
    const ctx: WsResolverContext = { url: 'wss://example.com/ws', params: {} }
    expect(() => resolveWsUrlToken(config, ctx)).toThrow('No token available')
  })
})

// ── ws_http_handshake ────────────────────────────

describe('resolveWsHttpHandshake', () => {
  const config: WsHttpHandshake = {
    type: 'ws_http_handshake',
    endpoint: 'https://slack.com/api/rtm.connect',
    method: 'GET',
    url_path: 'url',
  }

  it('calls endpoint and extracts WS URL from response', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, url: 'wss://cerberus.slack.com/ws/abc' })),
    ) as unknown as typeof fetch

    const ctx: WsResolverContext = {
      url: 'wss://placeholder',
      params: {},
      httpAuth: { token: 'xoxb-123', headers: { Authorization: 'Bearer xoxb-123' } },
      fetchImpl,
    }

    const result = await resolveWsHttpHandshake(config, ctx)
    expect(result).toEqual({ type: 'url', url: 'wss://cerberus.slack.com/ws/abc' })

    expect(fetchImpl).toHaveBeenCalledWith('https://slack.com/api/rtm.connect', {
      method: 'GET',
      headers: { Authorization: 'Bearer xoxb-123' },
    })
  })

  it('forwards cookies as Cookie header', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'wss://example.com/ws' })),
    ) as unknown as typeof fetch

    const ctx: WsResolverContext = {
      url: 'wss://placeholder',
      params: {},
      httpAuth: { cookieString: 'session=abc123' },
      fetchImpl,
    }

    await resolveWsHttpHandshake(config, ctx)
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), {
      method: 'GET',
      headers: { Cookie: 'session=abc123' },
    })
  })

  it('extracts URL from nested path', async () => {
    const nestedConfig: WsHttpHandshake = { ...config, url_path: 'data.websocket.url' }
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { websocket: { url: 'wss://deep.example.com' } } })),
    ) as unknown as typeof fetch

    const ctx: WsResolverContext = { url: 'wss://placeholder', params: {}, fetchImpl }
    const result = await resolveWsHttpHandshake(nestedConfig, ctx)
    expect(result).toEqual({ type: 'url', url: 'wss://deep.example.com' })
  })

  it('validates URL via ssrfValidator', async () => {
    const ssrfValidator = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'wss://example.com' })),
    ) as unknown as typeof fetch

    const ctx: WsResolverContext = { url: 'wss://placeholder', params: {}, fetchImpl, ssrfValidator }
    await resolveWsHttpHandshake(config, ctx)
    expect(ssrfValidator).toHaveBeenCalledWith('https://slack.com/api/rtm.connect')
  })

  it('throws on non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch
    const ctx: WsResolverContext = { url: 'wss://placeholder', params: {}, fetchImpl }
    await expect(resolveWsHttpHandshake(config, ctx)).rejects.toThrow('returned 401')
  })

  it('throws when URL not found at path', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch

    const ctx: WsResolverContext = { url: 'wss://placeholder', params: {}, fetchImpl }
    await expect(resolveWsHttpHandshake(config, ctx)).rejects.toThrow('WS URL not found')
  })
})

// ── WS Registry ──────────────────────────────────

describe('WS auth registry', () => {
  it('returns correct resolver for each type', () => {
    expect(getWsResolver('ws_upgrade_header')).toBeDefined()
    expect(getWsResolver('ws_first_message')).toBeDefined()
    expect(getWsResolver('ws_url_token')).toBeDefined()
    expect(getWsResolver('ws_http_handshake')).toBeDefined()
  })

  it('returns undefined for unknown type', () => {
    expect(getWsResolver('unknown_type')).toBeUndefined()
  })

  it('resolveWsAuth dispatches to correct handler', async () => {
    const config: WsAuthConfig = {
      type: 'ws_upgrade_header',
      inject: { header: 'X-Token' },
    }
    const ctx: WsResolverContext = { url: 'wss://example.com', params: { token: 'tok' } }
    const result = await resolveWsAuth(config, ctx)
    expect(result).toEqual({ type: 'headers', headers: { 'X-Token': 'tok' } })
  })

  it('resolveWsAuth throws for unknown type', () => {
    const config = { type: 'nonexistent' } as unknown as WsAuthConfig
    const ctx: WsResolverContext = { url: 'wss://example.com', params: {} }
    expect(() => resolveWsAuth(config, ctx)).toThrow('Unsupported WS auth type')
  })
})
