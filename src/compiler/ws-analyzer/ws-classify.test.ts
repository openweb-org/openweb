import { describe, expect, it } from 'vitest'

import type { ParsedWsFrame } from './ws-load.js'
import type { WsMessageCluster } from './ws-cluster.js'
import { classifyClusters } from './ws-classify.js'

// ── Helpers ───────────────────────────────────────────────────

function frame(direction: 'sent' | 'received', payload: Record<string, unknown>, ts = 0): ParsedWsFrame {
  return { direction, timestamp: ts, payload }
}

function cluster(
  direction: 'sent' | 'received',
  frames: ParsedWsFrame[],
  discValue: string | number = '*',
): WsMessageCluster {
  return {
    discriminatorValue: discValue,
    direction,
    frames,
    count: frames.length,
  }
}

// ── Heartbeat detection ──────────────────────────────────────

describe('heartbeat detection', () => {
  it('classifies periodic ping/pong as heartbeat', () => {
    const pings = cluster('sent', [
      frame('sent', { op: 1, d: null }, 0),
      frame('sent', { op: 1, d: null }, 1000),
      frame('sent', { op: 1, d: null }, 2000),
      frame('sent', { op: 1, d: null }, 3000),
    ], 1)

    const pongs = cluster('received', [
      frame('received', { op: 11, d: null }, 50),
      frame('received', { op: 11, d: null }, 1050),
      frame('received', { op: 11, d: null }, 2050),
      frame('received', { op: 11, d: null }, 3050),
    ], 11)

    const result = classifyClusters([pings, pongs])
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('heartbeat')
    expect(result[1].pattern).toBe('heartbeat')
  })

  it('detects heartbeat even without ack cluster', () => {
    const pings = cluster('sent', [
      frame('sent', { type: 'ping' }, 0),
      frame('sent', { type: 'ping' }, 500),
      frame('sent', { type: 'ping' }, 1000),
      frame('sent', { type: 'ping' }, 1500),
    ], 'ping')

    const result = classifyClusters([pings])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('heartbeat')
  })
})

// ── Request/reply detection ──────────────────────────────────

describe('request/reply detection', () => {
  it('classifies id-correlated sent/received pairs', () => {
    const sent = cluster('sent', [
      frame('sent', { type: 'query', id: 'a1', query: 'SELECT 1' }),
      frame('sent', { type: 'query', id: 'a2', query: 'SELECT 2' }),
    ], 'query')

    const received = cluster('received', [
      frame('received', { type: 'result', id: 'a1', data: [1] }),
      frame('received', { type: 'result', id: 'a2', data: [2] }),
    ], 'result')

    const result = classifyClusters([sent, received])
    expect(result).toHaveLength(2)
    expect(result[0].pattern).toBe('request_reply')
    expect(result[1].pattern).toBe('request_reply')
  })

  it('detects correlation via request_id field', () => {
    const sent = cluster('sent', [
      frame('sent', { method: 'getUser', request_id: 42 }),
    ], 'getUser')

    const received = cluster('received', [
      frame('received', { result: 'ok', request_id: 42 }),
    ], 'ok')

    const result = classifyClusters([sent, received])
    expect(result.find((c) => c.direction === 'sent')!.pattern).toBe('request_reply')
  })
})

// ── Subscribe detection ──────────────────────────────────────

describe('subscribe detection', () => {
  it('classifies few sends + many receives as subscribe', () => {
    const sub = cluster('sent', [
      frame('sent', { type: 'subscribe', channel: 'trades' }),
    ], 'subscribe')

    const events = cluster('received', [
      frame('received', { type: 'trade', price: 100 }),
      frame('received', { type: 'trade', price: 101 }),
      frame('received', { type: 'trade', price: 102 }),
      frame('received', { type: 'trade', price: 103 }),
      frame('received', { type: 'trade', price: 104 }),
      frame('received', { type: 'trade', price: 105 }),
    ], 'trade')

    const result = classifyClusters([sub, events])
    expect(result.find((c) => c.direction === 'sent')!.pattern).toBe('subscribe')
    // The received side has no correlation → stream
    expect(result.find((c) => c.direction === 'received')!.pattern).toBe('stream')
  })
})

// ── Event / stream detection ─────────────────────────────────

describe('event detection', () => {
  it('classifies receive-only clusters as stream', () => {
    const events = cluster('received', [
      frame('received', { type: 'notification', msg: 'hello' }),
      frame('received', { type: 'notification', msg: 'world' }),
      frame('received', { type: 'notification', msg: 'foo' }),
    ], 'notification')

    const result = classifyClusters([events])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('stream')
  })

  it('classifies server-push without matching sends as stream', () => {
    const sent = cluster('sent', [
      frame('sent', { type: 'auth', token: 'xxx' }),
    ], 'auth')

    const push = cluster('received', [
      frame('received', { type: 'price_update', symbol: 'BTC', price: 50000 }),
      frame('received', { type: 'price_update', symbol: 'BTC', price: 50100 }),
      frame('received', { type: 'price_update', symbol: 'ETH', price: 3000 }),
      frame('received', { type: 'price_update', symbol: 'ETH', price: 3010 }),
    ], 'price_update')

    const result = classifyClusters([sent, push])
    expect(result.find((c) => c.discriminatorValue === 'price_update')!.pattern).toBe('stream')
  })
})

// ── Publish detection ────────────────────────────────────────

describe('publish detection', () => {
  it('classifies send-only without correlation as publish', () => {
    const logs = cluster('sent', [
      frame('sent', { type: 'log', level: 'info', msg: 'started' }),
      frame('sent', { type: 'log', level: 'warn', msg: 'slow query' }),
      frame('sent', { type: 'log', level: 'info', msg: 'finished' }),
    ], 'log')

    const result = classifyClusters([logs])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('publish')
  })

  it('classifies fire-and-forget sends as publish', () => {
    const sent = cluster('sent', [
      frame('sent', { action: 'track', event: 'page_view' }),
      frame('sent', { action: 'track', event: 'click' }),
      frame('sent', { action: 'track', event: 'scroll' }),
      frame('sent', { action: 'track', event: 'page_view' }),
      frame('sent', { action: 'track', event: 'click' }),
      frame('sent', { action: 'track', event: 'submit' }),
    ], 'track')

    const result = classifyClusters([sent])
    expect(result).toHaveLength(1)
    expect(result[0].pattern).toBe('publish')
  })
})

// ── Mixed traffic ────────────────────────────────────────────

describe('mixed traffic', () => {
  it('correctly classifies a mix of patterns', () => {
    const heartbeat = cluster('sent', [
      frame('sent', { op: 1 }, 0),
      frame('sent', { op: 1 }, 1000),
      frame('sent', { op: 1 }, 2000),
      frame('sent', { op: 1 }, 3000),
    ], 1)

    const heartbeatAck = cluster('received', [
      frame('received', { op: 11 }, 50),
      frame('received', { op: 11 }, 1050),
      frame('received', { op: 11 }, 2050),
      frame('received', { op: 11 }, 3050),
    ], 11)

    const request = cluster('sent', [
      frame('sent', { op: 'query', id: 'r1', sql: 'SELECT 1' }),
    ], 'query')

    const reply = cluster('received', [
      frame('received', { op: 'result', id: 'r1', rows: [] }),
    ], 'result')

    const events = cluster('received', [
      frame('received', { op: 0, t: 'MSG', d: {} }),
      frame('received', { op: 0, t: 'MSG', d: {} }),
      frame('received', { op: 0, t: 'MSG', d: {} }),
    ], 0)

    const result = classifyClusters([heartbeat, heartbeatAck, request, reply, events])

    const patterns = new Map(result.map((c) => [c.discriminatorValue, c.pattern]))
    expect(patterns.get(1)).toBe('heartbeat')
    expect(patterns.get(11)).toBe('heartbeat')
    expect(patterns.get('query')).toBe('request_reply')
    expect(patterns.get('result')).toBe('request_reply')
    expect(patterns.get(0)).toBe('stream')
  })
})
