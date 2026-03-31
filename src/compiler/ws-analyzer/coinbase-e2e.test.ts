import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { validateAsyncApiSpec } from '../../types/validator.js'
import { classifyClusters } from './ws-classify.js'
import { analyzeWsConnection } from './ws-cluster.js'
import { loadWsCapture } from './ws-load.js'
import { inferWsSchemas } from './ws-schema.js'

// ── Fixture path ──────────────────────────────────────────────────

const FIXTURE_DIR = path.resolve(import.meta.dirname, '../../sites/coinbase')
const JSONL_PATH = path.join(FIXTURE_DIR, 'websocket_frames.jsonl')
const ASYNCAPI_PATH = path.join(FIXTURE_DIR, 'asyncapi.yaml')

// ── Constants ─────────────────────────────────────────────────────

const MIN_WS_FRAMES = 10
const EXECUTABLE_PATTERNS = new Set(['subscribe', 'publish', 'request_reply', 'stream'])

// ── Tests ─────────────────────────────────────────────────────────

describe('Coinbase Exchange WS end-to-end', () => {
  // ── Stage 1: Load & Parse ───────────────────────────────────────

  it('loads JSONL with ≥ 10 JSON frames', async () => {
    const connections = await loadWsCapture(JSONL_PATH)
    expect(connections).toHaveLength(1)

    const conn = connections[0]
    expect(conn.url).toBe('wss://ws-feed.exchange.coinbase.com')
    expect(conn.frames.length).toBeGreaterThanOrEqual(MIN_WS_FRAMES)
  })

  it('has both sent and received frames', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const sent = conn.frames.filter((f) => f.direction === 'sent')
    const received = conn.frames.filter((f) => f.direction === 'received')

    // 2 subscribe + 1 unsubscribe
    expect(sent.length).toBe(3)
    // Subscriptions confirmations + ticker events
    expect(received.length).toBeGreaterThanOrEqual(10)
  })

  // ── Stage 2: Discriminator Detection & Clustering ────────────────

  it('detects type as sent discriminator', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)

    expect(analysis.discriminator.sent).toBeDefined()
    expect(analysis.discriminator.sent?.field).toBe('type')
  })

  it('detects type as received discriminator with product_id sub-field', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)

    expect(analysis.discriminator.received).toBeDefined()
    expect(analysis.discriminator.received?.field).toBe('type')
    expect(analysis.discriminator.received?.sub_field).toBe('product_id')
    expect(analysis.discriminator.received?.sub_field_on).toBe('ticker')
  })

  it('produces clusters for subscribe, unsubscribe, and ticker', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)

    const values = analysis.clusters.map((c) => String(c.discriminatorValue))
    expect(values).toContain('subscribe')
    expect(values).toContain('unsubscribe')
    expect(values).toContain('ticker')
  })

  // ── Stage 3: Pattern Classification ──────────────────────────────

  it('classifies subscribe as subscribe pattern', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)

    const subCluster = classified.find(
      (c) => c.direction === 'sent' && c.discriminatorValue === 'subscribe',
    )
    expect(subCluster).toBeDefined()
    expect(subCluster?.pattern).toBe('subscribe')
  })

  it('classifies ticker/BTC-USD as stream', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)

    const btcStream = classified.find(
      (c) => c.discriminatorValue === 'ticker' && c.subValue === 'BTC-USD',
    )
    expect(btcStream).toBeDefined()
    expect(btcStream?.pattern).toBe('stream')
  })

  it('classifies ticker/ETH-USD as stream', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)

    const ethStream = classified.find(
      (c) => c.discriminatorValue === 'ticker' && c.subValue === 'ETH-USD',
    )
    expect(ethStream).toBeDefined()
    expect(ethStream?.pattern).toBe('stream')
  })

  it('has ≥ 1 executable pattern', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)

    const executable = classified.filter((c) => EXECUTABLE_PATTERNS.has(c.pattern))
    expect(executable.length).toBeGreaterThanOrEqual(1)
  })

  // ── Stage 4: Schema Inference ────────────────────────────────────

  it('produces 4 WS operations', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)
    const executable = classified.filter((c) => EXECUTABLE_PATTERNS.has(c.pattern))
    const ops = inferWsSchemas(executable)

    expect(ops).toHaveLength(4)

    const ids = ops.map((o) => o.operationId).sort()
    expect(ids).toEqual([
      'ws_recv_ticker_BTC_USD',
      'ws_recv_ticker_ETH_USD',
      'ws_send_subscribe',
      'ws_send_unsubscribe',
    ])
  })

  it('subscribe operation has message template with channels binding', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)
    const executable = classified.filter((c) => EXECUTABLE_PATTERNS.has(c.pattern))
    const ops = inferWsSchemas(executable)

    const sub = ops.find((o) => o.operationId === 'ws_send_subscribe')
    expect(sub).toBeDefined()
    expect(sub?.pattern).toBe('subscribe')
    expect(sub?.messageTemplate).toBeDefined()
    expect(sub?.messageTemplate?.constants).toEqual({ type: 'subscribe' })

    const bindingPaths = sub?.messageTemplate?.bindings.map((b) => b.path)
    expect(bindingPaths).toContain('channels')
  })

  it('ticker schemas have required fields', async () => {
    const [conn] = await loadWsCapture(JSONL_PATH)
    const analysis = analyzeWsConnection(conn)
    const classified = classifyClusters(analysis.clusters)
    const executable = classified.filter((c) => EXECUTABLE_PATTERNS.has(c.pattern))
    const ops = inferWsSchemas(executable)

    const btc = ops.find((o) => o.operationId === 'ws_recv_ticker_BTC_USD')
    expect(btc).toBeDefined()
    expect(btc?.payloadSchema.type).toBe('object')
    expect(btc?.payloadSchema.required).toContain('type')
    expect(btc?.payloadSchema.required).toContain('product_id')
    expect(btc?.payloadSchema.required).toContain('price')
    expect(btc?.payloadSchema.required).toContain('time')
    expect(btc?.payloadSchema.properties).toHaveProperty('trade_id')
  })

  // ── Committed AsyncAPI spec validation ────────────────────────────

  it('committed asyncapi.yaml passes validateAsyncApiSpec', async () => {
    const raw = await readFile(ASYNCAPI_PATH, 'utf8')
    const spec = parse(raw)
    const result = validateAsyncApiSpec(spec)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('committed asyncapi.yaml has correct structure', async () => {
    const raw = await readFile(ASYNCAPI_PATH, 'utf8')
    const spec = parse(raw) as Record<string, unknown>

    expect(spec.asyncapi).toBe('3.0.0')

    const info = spec.info as Record<string, unknown>
    expect(info.title).toBe('coinbase WebSocket API')

    // Server
    const servers = spec.servers as Record<string, Record<string, unknown>>
    const serverKeys = Object.keys(servers)
    expect(serverKeys).toHaveLength(1)
    const server = servers[serverKeys[0]]
    expect(server.host).toBe('ws-feed.exchange.coinbase.com')
    expect(server.protocol).toBe('wss')

    // Discriminator
    const xopenweb = server['x-openweb'] as Record<string, unknown>
    const disc = xopenweb.discriminator as Record<string, Record<string, unknown>>
    expect(disc.sent.field).toBe('type')
    expect(disc.received.field).toBe('type')
    expect(disc.received.sub_field).toBe('product_id')
    expect(disc.received.sub_field_on).toBe('ticker')

    // Operations
    const ops = spec.operations as Record<string, Record<string, unknown>>
    expect(ops.ws_send_subscribe).toBeDefined()
    expect(ops.ws_recv_ticker_BTC_USD).toBeDefined()
    expect(ops.ws_recv_ticker_ETH_USD).toBeDefined()

    // Subscribe has subscribe_message
    const subExt = ops.ws_send_subscribe['x-openweb'] as Record<string, unknown>
    expect(subExt.pattern).toBe('subscribe')
    expect(subExt.subscribe_message).toBeDefined()

    // Ticker streams
    const btcExt = ops.ws_recv_ticker_BTC_USD['x-openweb'] as Record<string, unknown>
    expect(btcExt.pattern).toBe('stream')
    expect(btcExt.permission).toBe('read')
  })
})
