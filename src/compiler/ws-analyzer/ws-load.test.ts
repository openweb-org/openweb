import { describe, expect, it } from 'vitest'

import { parseWsCapture } from './ws-load.js'

// ── Helpers ───────────────────────────────────────────────────

function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n')
}

const T0 = '2026-03-24T10:00:00.000Z'
const T1 = '2026-03-24T10:00:01.000Z'
const T2 = '2026-03-24T10:00:02.000Z'
const T3 = '2026-03-24T10:00:03.000Z'
const T4 = '2026-03-24T10:00:04.000Z'

// ── Tests ─────────────────────────────────────────────────────

describe('ws-load', () => {
  it('groups frames by connectionId and orders by timestamp', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'b', timestamp: T0, type: 'open', url: 'wss://other.com' },
      { connectionId: 'a', timestamp: T2, type: 'frame', direction: 'received', opcode: 1, payload: '{"op":0}' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'sent', opcode: 1, payload: '{"op":1}' },
      { connectionId: 'b', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '{"type":"hello"}' },
    )

    const connections = parseWsCapture(input)
    expect(connections).toHaveLength(2)

    const connA = connections.find((c) => c.connectionId === 'a')
    expect(connA).toBeDefined()
    expect(connA?.url).toBe('wss://example.com')
    expect(connA?.frames).toHaveLength(2)
    // Should be sorted: T1 (sent) before T2 (received)
    expect(connA?.frames[0]?.direction).toBe('sent')
    expect(connA?.frames[1]?.direction).toBe('received')

    const connB = connections.find((c) => c.connectionId === 'b')
    expect(connB).toBeDefined()
    expect(connB?.url).toBe('wss://other.com')
    expect(connB?.frames).toHaveLength(1)
  })

  it('parses JSON payloads and skips binary frames', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'sent', opcode: 1, payload: '{"action":"sub"}' },
      { connectionId: 'a', timestamp: T2, type: 'frame', direction: 'received', opcode: 2, payload: 'binary-data' },
      { connectionId: 'a', timestamp: T3, type: 'frame', direction: 'received', opcode: 1, payload: 'not-json' },
      { connectionId: 'a', timestamp: T4, type: 'frame', direction: 'received', opcode: 1, payload: '{"price":42.5}' },
    )

    const connections = parseWsCapture(input)
    expect(connections).toHaveLength(1)
    const conn = connections[0]
    expect(conn).toBeDefined()
    // Binary (opcode 2) and non-JSON text frames are skipped
    expect(conn?.frames).toHaveLength(2)
    expect(conn?.frames[0]?.payload).toEqual({ action: 'sub' })
    expect(conn?.frames[1]?.payload).toEqual({ price: 42.5 })
  })

  it('extracts handshake metadata from enhanced open frames', () => {
    const input = jsonl(
      {
        connectionId: 'a',
        timestamp: T0,
        type: 'open',
        url: 'wss://gateway.discord.gg/',
        requestHeaders: [
          { name: 'Cookie', value: 'session=abc' },
          { name: 'Origin', value: 'https://discord.com' },
        ],
        responseStatus: 101,
        responseHeaders: [{ name: 'Sec-WebSocket-Accept', value: 'xyz' }],
        subprotocol: 'graphql-ws',
      },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '{"op":10}' },
    )

    const connections = parseWsCapture(input)
    const conn = connections[0]
    expect(conn).toBeDefined()
    expect(conn?.handshake).toBeDefined()
    expect(conn.handshake?.requestHeaders).toEqual([
      { name: 'Cookie', value: 'session=abc' },
      { name: 'Origin', value: 'https://discord.com' },
    ])
    expect(conn.handshake?.responseStatus).toBe(101)
    expect(conn.handshake?.responseHeaders).toEqual([{ name: 'Sec-WebSocket-Accept', value: 'xyz' }])
    expect(conn.handshake?.subprotocol).toBe('graphql-ws')
  })

  it('returns no handshake for open frames without headers', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '{"ok":true}' },
    )

    const connections = parseWsCapture(input)
    expect(connections[0]?.handshake).toBeUndefined()
  })

  it('returns empty array for empty input', () => {
    expect(parseWsCapture('')).toEqual([])
    expect(parseWsCapture('\n\n')).toEqual([])
  })

  it('captures close code and close timestamp', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '{"op":10}' },
      { connectionId: 'a', timestamp: T2, type: 'close', code: 1000 },
    )

    const connections = parseWsCapture(input)
    const conn = connections[0]
    expect(conn).toBeDefined()
    expect(conn?.closeCode).toBe(1000)
    expect(conn?.closeTimestamp).toBe(new Date(T2).getTime())
  })

  it('sets openTimestamp from open frame', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '{"ok":1}' },
    )

    const connections = parseWsCapture(input)
    expect(connections[0]?.openTimestamp).toBe(new Date(T0).getTime())
  })

  it('skips JSON arrays and primitives — only objects become payloads', () => {
    const input = jsonl(
      { connectionId: 'a', timestamp: T0, type: 'open', url: 'wss://example.com' },
      { connectionId: 'a', timestamp: T1, type: 'frame', direction: 'received', opcode: 1, payload: '[1,2,3]' },
      { connectionId: 'a', timestamp: T2, type: 'frame', direction: 'received', opcode: 1, payload: '"hello"' },
      { connectionId: 'a', timestamp: T3, type: 'frame', direction: 'received', opcode: 1, payload: '42' },
    )

    const connections = parseWsCapture(input)
    expect(connections[0]?.frames).toHaveLength(0)
  })
})
