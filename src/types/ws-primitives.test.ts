import { describe, expect, it } from 'vitest'

import type { WsAuthConfig, WsBinding, WsHeartbeat, WsMessageTemplate, WsPattern } from './ws-primitives.js'
import type { XOpenWebWsOperation, XOpenWebWsServer } from './ws-extensions.js'
import { validateAsyncApiSpec } from './validator.js'

// ── Type compile checks ────────────────────────────

describe('WS primitive types compile', () => {
  it('WsAuthConfig — all 4 variants', () => {
    const firstMessage: WsAuthConfig = {
      type: 'ws_first_message',
      discriminator: { op: 2 },
      token_path: 'd.token',
      token_source: 'param',
    }
    const upgradeHeader: WsAuthConfig = {
      type: 'ws_upgrade_header',
      inject: { header: 'Authorization', prefix: 'Bearer ' },
    }
    const urlToken: WsAuthConfig = {
      type: 'ws_url_token',
      param: 'token',
      token_source: 'http_auth',
    }
    const httpHandshake: WsAuthConfig = {
      type: 'ws_http_handshake',
      endpoint: '/api/rtm.connect',
      method: 'POST',
      url_path: 'url',
    }
    expect(firstMessage.type).toBe('ws_first_message')
    expect(upgradeHeader.type).toBe('ws_upgrade_header')
    expect(urlToken.type).toBe('ws_url_token')
    expect(httpHandshake.type).toBe('ws_http_handshake')
  })

  it('WsBinding + WsMessageTemplate', () => {
    const binding: WsBinding = { path: 'd', source: 'state', key: 'sequence' }
    const template: WsMessageTemplate = {
      constants: { op: 1 },
      bindings: [binding],
    }
    expect(template.constants.op).toBe(1)
    expect(template.bindings).toHaveLength(1)
  })

  it('WsHeartbeat', () => {
    const hb: WsHeartbeat = {
      send: { constants: { op: 1 }, bindings: [{ path: 'd', source: 'state', key: 'sequence' }] },
      ack_discriminator: { op: 11 },
      interval_field: 'd.heartbeat_interval',
      max_missed: 3,
    }
    expect(hb.send.constants.op).toBe(1)
    expect(hb.max_missed).toBe(3)
  })

  it('WsPattern', () => {
    const patterns: WsPattern[] = ['subscribe', 'publish', 'request_reply', 'stream']
    expect(patterns).toHaveLength(4)
  })
})

describe('WS extension types compile', () => {
  it('XOpenWebWsServer', () => {
    const server: XOpenWebWsServer = {
      transport: 'node',
      discriminator: {
        sent: { field: 'op' },
        received: { field: 'op', sub_field: 't', sub_field_on: 0 },
      },
      auth: { type: 'ws_first_message', discriminator: { op: 2 }, token_path: 'd.token', token_source: 'param' },
      heartbeat: {
        send: { constants: { op: 1 }, bindings: [{ path: 'd', source: 'state', key: 'sequence' }] },
        ack_discriminator: { op: 11 },
        interval_field: 'd.heartbeat_interval',
        max_missed: 3,
      },
      reconnect: { max_retries: 5, backoff_ms: 1000 },
    }
    expect(server.transport).toBe('node')
    expect(server.discriminator.received?.sub_field).toBe('t')
  })

  it('XOpenWebWsOperation', () => {
    const op: XOpenWebWsOperation = {
      permission: 'read',
      pattern: 'subscribe',
      subscribe_message: {
        constants: { action: 'subscribe' },
        bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
      },
      unsubscribe_message: {
        constants: { action: 'unsubscribe' },
        bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
      },
    }
    expect(op.pattern).toBe('subscribe')
  })
})

// ── Validator tests ────────────────────────────────

function validAsyncApiSpec(overrides: Record<string, unknown> = {}) {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Test WS API', version: '1.0.0' },
    servers: {
      main: {
        host: 'ws.example.com',
        protocol: 'wss',
        'x-openweb': {
          transport: 'node',
          discriminator: { sent: { field: 'op' }, received: { field: 'op' } },
        },
      },
    },
    operations: {
      subscribe_events: {
        action: 'send',
        'x-openweb': {
          permission: 'read',
          pattern: 'subscribe',
          subscribe_message: {
            constants: { action: 'subscribe' },
            bindings: [{ path: 'channel', source: 'param', key: 'channel' }],
          },
        },
      },
    },
    ...overrides,
  }
}

describe('validateAsyncApiSpec', () => {
  it('passes a valid AsyncAPI 3.0 spec with x-openweb extensions', () => {
    const result = validateAsyncApiSpec(validAsyncApiSpec())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes a minimal spec with no x-openweb extensions', () => {
    const result = validateAsyncApiSpec({
      asyncapi: '3.0.0',
      info: { title: 'Bare', version: '0.1.0' },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects non-object spec', () => {
    for (const bad of [null, undefined, 42, 'string', []]) {
      const result = validateAsyncApiSpec(bad as never)
      expect(result.valid).toBe(false)
    }
  })

  it('rejects wrong asyncapi version', () => {
    const result = validateAsyncApiSpec(validAsyncApiSpec({ asyncapi: '2.6.0' }))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects missing asyncapi field', () => {
    const { asyncapi: _, ...noVersion } = validAsyncApiSpec()
    const result = validateAsyncApiSpec(noVersion)
    expect(result.valid).toBe(false)
  })

  it('rejects missing info.title', () => {
    const result = validateAsyncApiSpec(validAsyncApiSpec({ info: { version: '1.0.0' } }))
    expect(result.valid).toBe(false)
  })

  it('rejects invalid server x-openweb (missing discriminator)', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          main: {
            host: 'ws.example.com',
            'x-openweb': { transport: 'node' }, // missing discriminator
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('servers.main'))).toBe(true)
  })

  it('rejects invalid server x-openweb (bad transport)', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          main: {
            host: 'ws.example.com',
            'x-openweb': {
              transport: 'browser',
              discriminator: { sent: null, received: null },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('rejects invalid operation x-openweb (bad pattern)', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        operations: {
          bad_op: {
            action: 'send',
            'x-openweb': { permission: 'read', pattern: 'invalid_pattern' },
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('operations.bad_op'))).toBe(true)
  })

  it('rejects invalid operation x-openweb (missing permission)', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        operations: {
          no_perm: {
            action: 'send',
            'x-openweb': { pattern: 'stream' },
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('validates ws_first_message auth config', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          gw: {
            host: 'gateway.example.com',
            'x-openweb': {
              transport: 'node',
              discriminator: { sent: { field: 'op' }, received: { field: 'op', sub_field: 't', sub_field_on: 0 } },
              auth: {
                type: 'ws_first_message',
                discriminator: { op: 2 },
                token_path: 'd.token',
                token_source: 'param',
              },
              heartbeat: {
                send: { constants: { op: 1 }, bindings: [{ path: 'd', source: 'state', key: 'sequence' }] },
                ack_discriminator: { op: 11 },
                interval_field: 'd.heartbeat_interval',
                max_missed: 3,
              },
              reconnect: { max_retries: 5, backoff_ms: 1000 },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('validates ws_http_handshake auth config', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          slack: {
            host: 'wss-primary.slack.com',
            'x-openweb': {
              transport: 'node',
              discriminator: { sent: { field: 'type' }, received: { field: 'type' } },
              auth: {
                type: 'ws_http_handshake',
                endpoint: '/api/rtm.connect',
                method: 'POST',
                url_path: 'url',
              },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('validates request_reply operation with correlation', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        operations: {
          rpc_call: {
            action: 'send',
            'x-openweb': {
              permission: 'write',
              pattern: 'request_reply',
              correlation: { field: 'request_id', source: 'uuid' },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('rejects invalid ws auth type', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          bad: {
            host: 'x.com',
            'x-openweb': {
              transport: 'node',
              discriminator: { sent: null, received: null },
              auth: { type: 'invalid_auth_type' },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('rejects ws_first_message missing token_path', () => {
    const result = validateAsyncApiSpec(
      validAsyncApiSpec({
        servers: {
          bad: {
            host: 'x.com',
            'x-openweb': {
              transport: 'node',
              discriminator: { sent: null, received: null },
              auth: { type: 'ws_first_message', discriminator: { op: 2 }, token_source: 'param' },
            },
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
  })
})
