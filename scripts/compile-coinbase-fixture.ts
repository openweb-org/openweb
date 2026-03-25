/**
 * Generate synthetic Coinbase WS JSONL and run the WS compiler pipeline.
 *
 * Since no CDP browser is available, this creates a deterministic JSONL
 * fixture matching the Coinbase Exchange protocol, then feeds it through
 * the full WS compiler pipeline to produce asyncapi.yaml.
 *
 * Usage: pnpm exec tsx scripts/compile-coinbase-fixture.ts
 */
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { stringify } from 'yaml'

import { parseWsCapture } from '../src/compiler/ws-analyzer/ws-load.js'
import { analyzeWsConnection } from '../src/compiler/ws-analyzer/ws-cluster.js'
import { classifyClusters } from '../src/compiler/ws-analyzer/ws-classify.js'
import { inferWsSchemas } from '../src/compiler/ws-analyzer/ws-schema.js'
import { generateAsyncApi } from '../src/compiler/generator/asyncapi.js'

// ── JSONL generation ────────────────────────────────────────────

const CONN_ID = 'coinbase-ws-1'
const WS_URL = 'wss://ws-feed.exchange.coinbase.com'
const BASE = new Date('2026-03-25T12:00:00.000Z').getTime()

// Deterministic seeded PRNG (mulberry32) for reproducible jitter
function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(42)

/** Random interval between min and max ms (deterministic) */
function jitter(minMs: number, maxMs: number): number {
  return Math.round(minMs + rng() * (maxMs - minMs))
}

function ts(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString()
}

function openFrame(offsetMs: number) {
  return JSON.stringify({
    connectionId: CONN_ID,
    timestamp: ts(offsetMs),
    type: 'open',
    url: WS_URL,
    responseStatus: 101,
    responseHeaders: [{ name: 'Upgrade', value: 'websocket' }],
  })
}

function sentFrame(offsetMs: number, payload: Record<string, unknown>) {
  return JSON.stringify({
    connectionId: CONN_ID,
    timestamp: ts(offsetMs),
    type: 'frame',
    direction: 'sent',
    opcode: 1,
    payload: JSON.stringify(payload),
  })
}

function recvFrame(offsetMs: number, payload: Record<string, unknown>) {
  return JSON.stringify({
    connectionId: CONN_ID,
    timestamp: ts(offsetMs),
    type: 'frame',
    direction: 'received',
    opcode: 1,
    payload: JSON.stringify(payload),
  })
}

function closeFrame(offsetMs: number) {
  return JSON.stringify({
    connectionId: CONN_ID,
    timestamp: ts(offsetMs),
    type: 'close',
    code: 1000,
  })
}

function tickerPayload(productId: string, tradeId: number, price: string, offsetMs: number) {
  return {
    type: 'ticker',
    sequence: 1000 + tradeId,
    product_id: productId,
    price,
    open_24h: productId === 'BTC-USD' ? '66500.00' : '3400.00',
    volume_24h: productId === 'BTC-USD' ? '15234.567' : '98765.432',
    low_24h: productId === 'BTC-USD' ? '66100.00' : '3380.00',
    high_24h: productId === 'BTC-USD' ? '67800.00' : '3520.00',
    volume_30d: productId === 'BTC-USD' ? '456789.01' : '2345678.90',
    best_bid: productId === 'BTC-USD' ? (Number(price) - 0.5).toFixed(2) : (Number(price) - 0.1).toFixed(2),
    best_ask: productId === 'BTC-USD' ? (Number(price) + 0.5).toFixed(2) : (Number(price) + 0.1).toFixed(2),
    side: tradeId % 2 === 0 ? 'buy' : 'sell',
    time: ts(offsetMs),
    trade_id: tradeId,
    last_size: (rng() * 2).toFixed(8),
  }
}

const lines: string[] = []
let t = 0

// Connection open
lines.push(openFrame(t))
t += 50

// Subscribe BTC-USD
lines.push(sentFrame(t, {
  type: 'subscribe',
  channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
}))
t += 50

// Subscriptions confirmation
lines.push(recvFrame(t, {
  type: 'subscriptions',
  channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
}))
t += 100

// BTC-USD ticker events (10 events, realistic jitter 30-300ms)
const btcPrices = ['67234.01', '67235.50', '67230.00', '67228.75', '67240.10', '67245.00', '67238.50', '67250.25', '67248.00', '67255.30']
for (let i = 0; i < 10; i++) {
  lines.push(recvFrame(t, tickerPayload('BTC-USD', 100 + i, btcPrices[i], t)))
  t += jitter(30, 300)
}

// Subscribe ETH-USD (second subscribe → template inference)
lines.push(sentFrame(t, {
  type: 'subscribe',
  channels: [{ name: 'ticker', product_ids: ['ETH-USD'] }],
}))
t += 50

// Subscriptions confirmation (both products)
lines.push(recvFrame(t, {
  type: 'subscriptions',
  channels: [
    { name: 'ticker', product_ids: ['BTC-USD'] },
    { name: 'ticker', product_ids: ['ETH-USD'] },
  ],
}))
t += 100

// Interleaved BTC-USD + ETH-USD ticker events (~2.2s, ~20 events, jittered)
const ethPrices = ['3456.78', '3457.20', '3455.10', '3458.00', '3459.50', '3456.00', '3460.25', '3461.00', '3458.75', '3462.30']
for (let i = 0; i < 10; i++) {
  lines.push(recvFrame(t, tickerPayload('BTC-USD', 200 + i, btcPrices[i], t)))
  t += jitter(20, 250)
  lines.push(recvFrame(t, tickerPayload('ETH-USD', 300 + i, ethPrices[i], t)))
  t += jitter(20, 250)
}

// Unsubscribe BTC-USD
lines.push(sentFrame(t, {
  type: 'unsubscribe',
  channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
}))
t += 50

// Subscriptions confirmation (ETH-USD only)
lines.push(recvFrame(t, {
  type: 'subscriptions',
  channels: [{ name: 'ticker', product_ids: ['ETH-USD'] }],
}))
t += 100

// ETH-USD only ticker events (~0.8s, 6 events, jittered)
for (let i = 0; i < 6; i++) {
  lines.push(recvFrame(t, tickerPayload('ETH-USD', 400 + i, ethPrices[i], t)))
  t += jitter(40, 350)
}

// Close
lines.push(closeFrame(t))

const jsonlContent = `${lines.join('\n')}\n`

// ── Run WS compiler pipeline ─────────────────────────────────────

const connections = parseWsCapture(jsonlContent)
if (connections.length === 0) {
  process.stderr.write('ERROR: No connections parsed\n')
  process.exit(1)
}

const conn = connections[0]
process.stdout.write(`Parsed ${String(conn.frames.length)} frames from 1 connection\n`)

// Stage 2: Cluster + discriminator detection
const analysis = analyzeWsConnection(conn)
process.stdout.write(`Discriminator — sent: ${analysis.discriminator.sent?.field ?? 'none'}, received: ${analysis.discriminator.received?.field ?? 'none'}\n`)
if (analysis.discriminator.received?.sub_field) {
  process.stdout.write(`  sub_field: ${analysis.discriminator.received.sub_field} on ${String(analysis.discriminator.received.sub_field_on)}\n`)
}
process.stdout.write(`Clusters: ${String(analysis.clusters.length)}\n`)

// Stage 3: Classify patterns
const classified = classifyClusters(analysis.clusters)
for (const c of classified) {
  process.stdout.write(`  ${c.direction} ${String(c.discriminatorValue)}${c.subValue ? `/${String(c.subValue)}` : ''} → ${c.pattern} (${String(c.count)} frames)\n`)
}

// Gate: executable patterns
const EXECUTABLE = new Set(['subscribe', 'publish', 'request_reply', 'stream'])
const executable = classified.filter((c) => EXECUTABLE.has(c.pattern))
if (executable.length === 0) {
  process.stderr.write('ERROR: No executable patterns\n')
  process.exit(1)
}

// Stage 4: Schema inference
const wsOps = inferWsSchemas(executable)
process.stdout.write(`\nOperations: ${String(wsOps.length)}\n`)
for (const op of wsOps) {
  process.stdout.write(`  ${op.operationId} (${op.pattern}, ${op.direction})\n`)
}

// ── Generate output ──────────────────────────────────────────────

const outputRoot = path.resolve('src/sites/coinbase')
await mkdir(outputRoot, { recursive: true })

// Write JSONL fixture
await writeFile(path.join(outputRoot, 'websocket_frames.jsonl'), jsonlContent)
process.stdout.write(`\nWrote websocket_frames.jsonl (${String(lines.length)} lines)\n`)

// Generate AsyncAPI spec
await generateAsyncApi({
  site: 'coinbase',
  serverUrl: WS_URL,
  serverExtensions: {
    transport: 'node',
    discriminator: analysis.discriminator,
  },
  operations: wsOps,
  outputRoot,
  generatedAt: '2026-03-25T12:00:00.000Z',
})
process.stdout.write('Wrote asyncapi.yaml\n')

// Write manifest
const manifest = {
  name: 'coinbase',
  display_name: 'Coinbase Exchange',
  version: '1.0.0',
  spec_version: '2.0',
  site_url: 'https://exchange.coinbase.com',
  description: 'Coinbase Exchange WebSocket feed — public market data (no auth)',
  requires_auth: false,
  dependencies: {},
  stats: {
    operation_count: 0,
    l1_count: 0,
    l2_count: 0,
    l3_count: 0,
    ws_count: wsOps.length,
  },
}
await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
process.stdout.write('Wrote manifest.json\n')

process.stdout.write(`\nDone → ${outputRoot}\n`)
