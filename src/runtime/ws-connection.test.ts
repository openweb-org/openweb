import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { WsConnectionManager, type WsConnectionConfig, type WsState } from './ws-connection.js'
import { WsRouter, type WsRouterConfig } from './ws-router.js'
import { WsConnectionPool } from './ws-pool.js'

// ── Mock WebSocket ────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  protocol = ''
  private listeners = new Map<string, Array<(event: unknown) => void>>()

  constructor(url: string | URL, _protocols?: string | string[]) {
    this.url = String(url)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type)?.push(listener)
  }

  send(_data: string | ArrayBuffer): void {}

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    this.fireEvent('close', { code: code ?? 1000, reason: reason ?? '' })
  }

  // Test helpers
  fireEvent(type: string, detail: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(detail)
    }
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.fireEvent('open', {})
  }

  simulateMessage(data: unknown): void {
    this.fireEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.fireEvent('close', { code, reason })
  }

  simulateError(): void {
    this.fireEvent('error', {})
  }
}

/** Track created MockWebSocket instances */
let lastMockWs: MockWebSocket | null = null

function createMockFactory() {
  return (url: string, _protocols?: string[], _headers?: Record<string, string>) => {
    const ws = new MockWebSocket(url)
    lastMockWs = ws
    return ws as unknown as WebSocket
  }
}

// ── Connection Manager Tests ──────────────────────

describe('WsConnectionManager', () => {
  beforeEach(() => {
    lastMockWs = null
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const baseConfig: WsConnectionConfig = {
    url: 'wss://gateway.example.com/',
    socketFactory: createMockFactory(),
  }

  describe('state machine transitions', () => {
    it('starts in DISCONNECTED', () => {
      const conn = new WsConnectionManager(baseConfig)
      expect(conn.getState()).toBe('DISCONNECTED')
    })

    it('DISCONNECTED → CONNECTING → AUTHENTICATING on connect + open', () => {
      const states: WsState[] = []
      const conn = new WsConnectionManager(baseConfig)
      conn.on('stateChange', (_from, to) => states.push(to))

      conn.connect()
      expect(conn.getState()).toBe('CONNECTING')

      lastMockWs?.simulateOpen()
      expect(conn.getState()).toBe('AUTHENTICATING')
      expect(states).toEqual(['CONNECTING', 'AUTHENTICATING'])
    })

    it('AUTHENTICATING → READY on completeAuth()', () => {
      const conn = new WsConnectionManager(baseConfig)
      conn.connect()
      lastMockWs?.simulateOpen()

      conn.completeAuth()
      expect(conn.getState()).toBe('READY')
    })

    it('READY → CLOSING → CLOSED on close()', () => {
      const conn = new WsConnectionManager(baseConfig)
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      conn.close()
      expect(conn.getState()).toBe('CLOSED')
    })

    it('AUTHENTICATING without auth goes directly to READY on hello', () => {
      const conn = new WsConnectionManager(baseConfig)
      conn.connect()
      lastMockWs?.simulateOpen()

      conn.handleHello({ heartbeat_interval: 30000 })
      expect(conn.getState()).toBe('READY')
    })

    it('does not transition on invalid state', () => {
      const conn = new WsConnectionManager(baseConfig)
      // Can't close from DISCONNECTED
      conn.close()
      expect(conn.getState()).toBe('DISCONNECTED')
    })
  })

  describe('heartbeat', () => {
    it('sends heartbeat at configured interval', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        heartbeat: {
          send: {
            constants: { op: 1 },
            bindings: [{ path: 'd', source: 'state', key: 'sequence' }],
          },
          ack_discriminator: { op: 11 },
          interval_ms: 1000,
          max_missed: 3,
        },
      }

      const conn = new WsConnectionManager(config)
      conn.setConnectionState({ sequence: 42 })
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      expect(lastMockWs).not.toBeNull()
      const sendSpy = vi.spyOn(lastMockWs as MockWebSocket, 'send')

      vi.advanceTimersByTime(1000)
      expect(sendSpy).toHaveBeenCalledTimes(1)
      const sent = JSON.parse(sendSpy.mock.calls[0]?.[0] as string)
      expect(sent).toEqual({ op: 1, d: 42 })

      vi.advanceTimersByTime(1000)
      expect(sendSpy).toHaveBeenCalledTimes(2)
    })

    it('extracts dynamic interval from hello message', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        heartbeat: {
          send: { constants: { op: 1 }, bindings: [] },
          interval_field: 'd.heartbeat_interval',
          interval_ms: 30000, // fallback
          max_missed: 3,
        },
      }

      const conn = new WsConnectionManager(config)
      conn.connect()
      lastMockWs?.simulateOpen()

      // Hello message provides dynamic interval
      conn.handleHello({ d: { heartbeat_interval: 500 } })
      // handleHello transitions to READY (no auth), starting heartbeat at 500ms

      expect(lastMockWs).not.toBeNull()
      const sendSpy = vi.spyOn(lastMockWs as MockWebSocket, 'send')
      vi.advanceTimersByTime(500)
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    it('triggers reconnect after max missed acks', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        heartbeat: {
          send: { constants: { op: 1 }, bindings: [] },
          interval_ms: 100,
          max_missed: 2,
        },
        reconnect: { max_retries: 3, backoff_ms: 100 },
      }

      const conn = new WsConnectionManager(config)
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      // Tick 3 times without ack → missed_count > max_missed(2) → RECONNECTING
      vi.advanceTimersByTime(100) // tick 1, missed=1
      vi.advanceTimersByTime(100) // tick 2, missed=2
      vi.advanceTimersByTime(100) // tick 3, missed=3 > 2 → reconnect

      expect(conn.getState()).toBe('RECONNECTING')
    })

    it('resets missed count on ack', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        heartbeat: {
          send: { constants: { op: 1 }, bindings: [] },
          interval_ms: 100,
          max_missed: 2,
        },
        reconnect: { max_retries: 3, backoff_ms: 100 },
      }

      const conn = new WsConnectionManager(config)
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      vi.advanceTimersByTime(100) // tick 1, missed=1
      conn.handleHeartbeatAck()   // missed=0
      vi.advanceTimersByTime(100) // tick 2, missed=1
      vi.advanceTimersByTime(100) // tick 3, missed=2
      // Still within max_missed (2), but next tick will trigger
      expect(conn.getState()).toBe('READY')
    })
  })

  describe('reconnect', () => {
    it('reconnects with exponential backoff', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        reconnect: { max_retries: 3, backoff_ms: 100 },
      }

      const conn = new WsConnectionManager(config)
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      // Unexpected close triggers reconnect
      lastMockWs?.simulateClose(1006, 'abnormal')
      expect(conn.getState()).toBe('RECONNECTING')

      // After backoff (100ms * 2^0 = 100ms), should transition to CONNECTING
      vi.advanceTimersByTime(100)
      expect(conn.getState()).toBe('CONNECTING')
    })

    it('gives up after max retries', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        reconnect: { max_retries: 1, backoff_ms: 50 },
      }

      const conn = new WsConnectionManager(config)
      const errors: Error[] = []
      conn.on('error', (e) => errors.push(e))

      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      // First unexpected close → RECONNECTING
      lastMockWs?.simulateClose(1006)
      expect(conn.getState()).toBe('RECONNECTING')

      // Retry
      vi.advanceTimersByTime(50)
      expect(conn.getState()).toBe('CONNECTING')

      // Second close → max retries exceeded
      lastMockWs?.simulateClose(1006)
      expect(conn.getState()).toBe('CLOSED')
    })

    it('does not reconnect without reconnect config', () => {
      const conn = new WsConnectionManager(baseConfig) // no reconnect config
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      lastMockWs?.simulateClose(1006)
      expect(conn.getState()).toBe('CLOSED')
    })
  })

  describe('destroy', () => {
    it('cleans up all resources', () => {
      const config: WsConnectionConfig = {
        ...baseConfig,
        heartbeat: {
          send: { constants: { op: 1 }, bindings: [] },
          interval_ms: 100,
          max_missed: 3,
        },
      }

      const conn = new WsConnectionManager(config)
      conn.connect()
      lastMockWs?.simulateOpen()
      conn.completeAuth()

      conn.destroy()
      expect(conn.getState()).toBe('CLOSED')
    })
  })
})

// ── Router Tests ──────────────────────────────────

describe('WsRouter', () => {
  const discordRouterConfig: WsRouterConfig = {
    discriminator: {
      sent: { field: 'op' },
      received: { field: 'op', sub_field: 't', sub_field_on: 0 },
    },
    controlPatterns: [
      { match: { op: 10 } }, // Hello
    ],
    ackPatterns: [
      { match: { op: 11 } }, // Heartbeat ACK
    ],
    responsePattern: undefined,
    eventRoutes: [
      { operationId: 'message_create', match: { op: 0, t: 'MESSAGE_CREATE' } },
      { operationId: 'presence_update', match: { op: 0, t: 'PRESENCE_UPDATE' } },
    ],
  }

  it('classifies control frames', () => {
    const router = new WsRouter(discordRouterConfig)
    const result = router.classify({ op: 10, d: { heartbeat_interval: 41250 } })
    expect(result.category).toBe('control')
  })

  it('classifies ack frames', () => {
    const router = new WsRouter(discordRouterConfig)
    const result = router.classify({ op: 11 })
    expect(result.category).toBe('ack')
  })

  it('classifies event frames with operationId', () => {
    const router = new WsRouter(discordRouterConfig)
    const result = router.classify({ op: 0, t: 'MESSAGE_CREATE', s: 1, d: { content: 'hello' } })
    expect(result.category).toBe('event')
    expect(result.operationId).toBe('message_create')
  })

  it('classifies unknown discriminator values as unknown', () => {
    const router = new WsRouter(discordRouterConfig)
    const result = router.classify({ op: 7 }) // RESUME — not in routes
    expect(result.category).toBe('unknown')
  })

  it('classifies response frames by correlation field', () => {
    const config: WsRouterConfig = {
      discriminator: { sent: { field: 'type' }, received: { field: 'type' } },
      controlPatterns: [],
      ackPatterns: [],
      responsePattern: { correlationField: 'request_id' },
      eventRoutes: [],
    }

    const router = new WsRouter(config)
    const result = router.classify({ type: 'response', request_id: 'abc-123', data: {} })
    expect(result.category).toBe('response')
  })

  it('returns unknown for non-object payloads', () => {
    const router = new WsRouter(discordRouterConfig)
    expect(router.classify('just a string').category).toBe('unknown')
    expect(router.classify(null).category).toBe('unknown')
    expect(router.classify(42).category).toBe('unknown')
  })
})

// ── Pool Tests ────────────────────────────────────

describe('WsConnectionPool', () => {
  beforeEach(() => {
    lastMockWs = null
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const config: WsConnectionConfig = {
    url: 'wss://gateway.example.com/',
    socketFactory: createMockFactory(),
  }

  it('reuses connection for same key', () => {
    const pool = new WsConnectionPool()
    const key = WsConnectionPool.buildKey('discord', 'wss://gateway.discord.gg', 'ws_first_message')

    const conn1 = pool.acquire(key, config)
    conn1.connect()
    lastMockWs?.simulateOpen()
    conn1.completeAuth()

    const conn2 = pool.acquire(key, config)
    expect(conn2).toBe(conn1)
    expect(pool.size(key)).toBe(1)

    pool.destroyAll()
  })

  it('creates new connection for different key', () => {
    const pool = new WsConnectionPool()
    const key1 = WsConnectionPool.buildKey('discord', 'wss://gateway.discord.gg', 'ws_first_message')
    const key2 = WsConnectionPool.buildKey('slack', 'wss://wss-primary.slack.com', 'ws_url_token')

    const conn1 = pool.acquire(key1, config)
    const conn2 = pool.acquire(key2, config)

    expect(conn1).not.toBe(conn2)
    expect(pool.size(key1)).toBe(1)
    expect(pool.size(key2)).toBe(1)

    pool.destroyAll()
  })

  it('creates new connection when existing is CLOSED', () => {
    const pool = new WsConnectionPool()
    const key = WsConnectionPool.buildKey('discord', 'wss://gateway.discord.gg')

    const conn1 = pool.acquire(key, config)
    conn1.connect()
    lastMockWs?.simulateOpen()
    conn1.completeAuth()
    conn1.close() // goes to CLOSED

    const conn2 = pool.acquire(key, config)
    expect(conn2).not.toBe(conn1)

    pool.destroyAll()
  })

  it('removes idle connections after timeout', () => {
    const pool = new WsConnectionPool({ idleTimeoutMs: 500 })
    const key = WsConnectionPool.buildKey('test', 'wss://example.com')

    const conn = pool.acquire(key, config)
    conn.connect()
    lastMockWs?.simulateOpen()
    conn.completeAuth()

    pool.release(key, conn)
    expect(pool.size(key)).toBe(1)

    vi.advanceTimersByTime(500)
    expect(pool.size(key)).toBe(0)
  })

  it('buildKey produces correct format', () => {
    expect(WsConnectionPool.buildKey('discord', 'wss://gw.discord.gg', 'ws_first_message'))
      .toBe('discord::wss://gw.discord.gg::ws_first_message')
    expect(WsConnectionPool.buildKey('test', 'wss://example.com'))
      .toBe('test::wss://example.com::none')
  })

  it('destroyAll clears all entries', () => {
    const pool = new WsConnectionPool()
    const key1 = WsConnectionPool.buildKey('a', 'wss://a.com')
    const key2 = WsConnectionPool.buildKey('b', 'wss://b.com')

    pool.acquire(key1, config)
    pool.acquire(key2, config)

    pool.destroyAll()
    expect(pool.size(key1)).toBe(0)
    expect(pool.size(key2)).toBe(0)
  })
})
