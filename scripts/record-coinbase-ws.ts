/**
 * Scripted recording for Coinbase Exchange WebSocket feed.
 *
 * Captures: subscribe (BTC-USD, ETH-USD), ticker stream, unsubscribe (BTC-USD).
 * Run via: pnpm dev compile wss://ws-feed.exchange.coinbase.com --script scripts/record-coinbase-ws.ts
 */
import { parseArgs } from 'node:util'

import { chromium } from 'playwright'

import { createCaptureSession } from '../src/capture/session.js'

const { values } = parseArgs({
  options: { out: { type: 'string' } },
  strict: false,
})
const outputDir = values.out
if (!outputDir) {
  process.stderr.write('Usage: record-coinbase-ws.ts --out <dir>\n')
  process.exit(1)
}

const cdpPort = process.env.OPENWEB_CDP_PORT ?? '9222'
const cdpEndpoint = `http://localhost:${cdpPort}`

const browser = await chromium.connectOverCDP(cdpEndpoint)
const context = browser.contexts()[0]
if (!context) throw new Error('No browser context')

const page = await context.newPage()
const session = createCaptureSession({
  cdpEndpoint,
  outputDir,
  targetPage: page,
  isolateToTargetPage: true,
  onLog: (msg) => process.stderr.write(`${msg}\n`),
})
await session.ready

await page.goto('about:blank')

await page.evaluate(async () => {
  const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com')
  await new Promise<void>((resolve) => { ws.onopen = () => resolve() })

  // Subscribe BTC-USD ticker
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
  }))
  await new Promise((r) => setTimeout(r, 1200))

  // Subscribe ETH-USD ticker (second subscribe for template inference)
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: [{ name: 'ticker', product_ids: ['ETH-USD'] }],
  }))
  await new Promise((r) => setTimeout(r, 2200))

  // Unsubscribe BTC-USD (makes sent type cardinality > 1)
  ws.send(JSON.stringify({
    type: 'unsubscribe',
    channels: [{ name: 'ticker', product_ids: ['BTC-USD'] }],
  }))
  await new Promise((r) => setTimeout(r, 800))

  ws.close()
})

session.stop()
await session.done
await page.close()
await browser.close()
