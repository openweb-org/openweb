import { describe, expect, it } from 'vitest'

import type { ParsedWsFrame } from './ws-load.js'
import type { ClassifiedCluster } from './ws-classify.js'
import type { WsPattern } from '../../types/ws-primitives.js'
import { inferWsSchemas } from './ws-schema.js'

// ── Helpers ───────────────────────────────────────────────────

function frame(direction: 'sent' | 'received', payload: Record<string, unknown>, ts = 0): ParsedWsFrame {
  return { direction, timestamp: ts, payload }
}

function classified(
  pattern: WsPattern,
  direction: 'sent' | 'received',
  frames: ParsedWsFrame[],
  discValue: string | number = '*',
  subValue?: string | number,
): ClassifiedCluster {
  return {
    pattern,
    discriminatorValue: discValue,
    subValue,
    direction,
    frames,
    count: frames.length,
  }
}

// ── Schema from uniform messages ─────────────────────────────

describe('schema inference from uniform messages', () => {
  it('infers object schema from uniform payloads', () => {
    const cluster = classified('stream', 'received', [
      frame('received', { type: 'price', symbol: 'BTC', price: 50000 }),
      frame('received', { type: 'price', symbol: 'ETH', price: 3000 }),
      frame('received', { type: 'price', symbol: 'BTC', price: 50100 }),
    ], 'price')

    const [schema] = inferWsSchemas([cluster])
    expect(schema.operationId).toBe('ws_recv_price')
    expect(schema.pattern).toBe('stream')
    expect(schema.direction).toBe('received')
    expect(schema.payloadSchema.type).toBe('object')
    expect(schema.payloadSchema.properties).toHaveProperty('type')
    expect(schema.payloadSchema.properties).toHaveProperty('symbol')
    expect(schema.payloadSchema.properties).toHaveProperty('price')
    expect(schema.payloadSchema.required).toContain('type')
    expect(schema.payloadSchema.required).toContain('symbol')
    expect(schema.payloadSchema.required).toContain('price')
  })

  it('generates operationId with sub-discriminator value', () => {
    const cluster = classified('stream', 'received', [
      frame('received', { op: 0, t: 'MESSAGE_CREATE', d: {} }),
    ], 0, 'MESSAGE_CREATE')

    const [schema] = inferWsSchemas([cluster])
    expect(schema.operationId).toBe('ws_recv_0_MESSAGE_CREATE')
  })
})

// ── Parameter extraction for subscribe ───────────────────────

describe('parameters extracted from varying subscribe fields', () => {
  it('extracts varying fields as parameters and constant fields as template', () => {
    const cluster = classified('subscribe', 'sent', [
      frame('sent', { action: 'subscribe', channel: 'trades', symbol: 'BTC' }),
      frame('sent', { action: 'subscribe', channel: 'trades', symbol: 'ETH' }),
      frame('sent', { action: 'subscribe', channel: 'orderbook', symbol: 'BTC' }),
    ], 'subscribe')

    const [schema] = inferWsSchemas([cluster])
    expect(schema.messageTemplate).toBeDefined()
    expect(schema.parameterSchema).toBeDefined()

    // 'action' is constant across all frames
    expect(schema.messageTemplate!.constants).toEqual({ action: 'subscribe' })

    // 'channel' and 'symbol' vary → bindings
    const bindingPaths = schema.messageTemplate!.bindings.map((b) => b.path).sort()
    expect(bindingPaths).toEqual(['channel', 'symbol'])

    // All bindings source from param
    for (const binding of schema.messageTemplate!.bindings) {
      expect(binding.source).toBe('param')
      expect(binding.key).toBe(binding.path)
    }

    // Parameter schema describes the varying fields
    expect(schema.parameterSchema!.type).toBe('object')
    expect(schema.parameterSchema!.properties).toHaveProperty('channel')
    expect(schema.parameterSchema!.properties).toHaveProperty('symbol')
    expect(schema.parameterSchema!.required).toContain('channel')
    expect(schema.parameterSchema!.required).toContain('symbol')
  })

  it('extracts parameters for publish patterns', () => {
    const cluster = classified('publish', 'sent', [
      frame('sent', { action: 'log', msg: 'hello' }),
      frame('sent', { action: 'log', msg: 'world' }),
    ], 'log')

    const [schema] = inferWsSchemas([cluster])
    // publish now gets template extraction (msg varies)
    expect(schema.parameterSchema).toBeDefined()
    expect(schema.messageTemplate).toBeDefined()
    expect(schema.messageTemplate!.constants).toEqual({ action: 'log' })
    expect(schema.messageTemplate!.bindings).toHaveLength(1)
    expect(schema.messageTemplate!.bindings[0].path).toBe('msg')
  })

  it('does not extract parameters when all fields are constant', () => {
    const cluster = classified('subscribe', 'sent', [
      frame('sent', { action: 'subscribe', channel: 'heartbeat' }),
      frame('sent', { action: 'subscribe', channel: 'heartbeat' }),
    ], 'subscribe')

    const [schema] = inferWsSchemas([cluster])
    // All fields identical → no varying fields → no template/params
    expect(schema.parameterSchema).toBeUndefined()
    expect(schema.messageTemplate).toBeUndefined()
  })
})

// ── Multiple clusters ────────────────────────────────────────

describe('multiple clusters produce independent schemas', () => {
  it('returns one schema per cluster', () => {
    const sub = classified('subscribe', 'sent', [
      frame('sent', { action: 'subscribe', topic: 'A' }),
      frame('sent', { action: 'subscribe', topic: 'B' }),
    ], 'subscribe')

    const events = classified('stream', 'received', [
      frame('received', { type: 'update', data: 1 }),
      frame('received', { type: 'update', data: 2 }),
    ], 'update')

    const heartbeat = classified('heartbeat', 'sent', [
      frame('sent', { op: 1 }, 0),
      frame('sent', { op: 1 }, 1000),
    ], 1)

    const schemas = inferWsSchemas([sub, events, heartbeat])
    expect(schemas).toHaveLength(3)

    // Each has a unique operationId
    const ids = schemas.map((s) => s.operationId)
    expect(new Set(ids).size).toBe(3)

    // Patterns match input
    expect(schemas[0].pattern).toBe('subscribe')
    expect(schemas[1].pattern).toBe('stream')
    expect(schemas[2].pattern).toBe('heartbeat')
  })
})

// ── Empty cluster ────────────────────────────────────────────

describe('empty cluster handling', () => {
  it('skips clusters with no frames', () => {
    const empty = classified('stream', 'received', [], 'empty')
    const schemas = inferWsSchemas([empty])
    expect(schemas).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(inferWsSchemas([])).toEqual([])
  })
})
