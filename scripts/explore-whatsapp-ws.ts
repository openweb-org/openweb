/**
 * Explore WhatsApp Web WebSocket traffic.
 *
 * Connects to a running Chrome (CDP on port 9222), finds the WhatsApp tab,
 * enables Network domain, and captures WS frames for 30 seconds.
 *
 * Logs frame type breakdown (binary vs text vs JSON), sizes, and sample content.
 * Saves raw capture to tmp/whatsapp-ws-explore.jsonl.
 *
 * Usage: npx tsx scripts/explore-whatsapp-ws.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CDP_PORT = process.env.OPENWEB_CDP_PORT ?? '9222'
const CAPTURE_DURATION_MS = 30_000
const OUTPUT_PATH = 'tmp/whatsapp-ws-explore.jsonl'

// ── Types ────────────────────────────────────────────────────

interface FrameRecord {
  timestamp: string
  connectionId: string
  direction: 'sent' | 'received'
  opcode: number
  payloadSize: number
  isJson: boolean
  jsonPreview?: string
  binaryPreview?: string
}

interface ConnectionInfo {
  url: string
  requestId: string
  openedAt: string
}

// ── CDP event types ──────────────────────────────────────────

interface CdpWsCreated {
  requestId: string
  url: string
}

interface CdpWsFrame {
  requestId: string
  timestamp: number
  response: { opcode: number; payloadData: string }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Connecting to Chrome CDP on port ${CDP_PORT}...`)
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)

  const contexts = browser.contexts()
  let whatsappPage = null
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (page.url().includes('web.whatsapp.com')) {
        whatsappPage = page
        break
      }
    }
    if (whatsappPage) break
  }

  if (!whatsappPage) {
    console.log('No WhatsApp tab found — opening web.whatsapp.com...')
    const ctx = contexts[0]
    if (!ctx) {
      console.error('No browser context available.')
      await browser.close()
      process.exit(1)
    }
    whatsappPage = await ctx.newPage()
    await whatsappPage.goto('https://web.whatsapp.com/', { waitUntil: 'networkidle' })
    // Wait for chat list (indicates logged in) or QR code
    console.log('Waiting for WhatsApp to load (up to 30s)...')
    try {
      await whatsappPage.waitForSelector('[data-testid="chat-list"]', { timeout: 30_000 })
      console.log('WhatsApp chat list loaded — session is active.')
    } catch {
      console.log('Chat list not detected in 30s — may need QR scan. Continuing capture anyway...')
    }
  } else {
    console.log(`Found existing WhatsApp tab: ${whatsappPage.url()}`)
  }

  const cdp = await whatsappPage.context().newCDPSession(whatsappPage)
  await cdp.send('Network.enable')

  const connections = new Map<string, ConnectionInfo>()
  const frames: FrameRecord[] = []
  const rawJsonlLines: string[] = []

  // Track stats
  let binaryCount = 0
  let textCount = 0
  let jsonCount = 0
  let totalBinaryBytes = 0
  let totalTextBytes = 0

  // ── Event handlers ──────────────────────────────────────────

  cdp.on('Network.webSocketCreated', (e: CdpWsCreated) => {
    connections.set(e.requestId, {
      url: e.url,
      requestId: e.requestId,
      openedAt: new Date().toISOString(),
    })
    const line = JSON.stringify({ type: 'open', connectionId: e.requestId, url: e.url, timestamp: new Date().toISOString() })
    rawJsonlLines.push(line)
    console.log(`  [WS OPEN] ${e.url}`)
  })

  const handleFrame = (e: CdpWsFrame, direction: 'sent' | 'received'): void => {
    const { opcode, payloadData } = e.response
    const size = payloadData.length
    const isBinary = opcode === 2
    const timestamp = new Date().toISOString()

    const record: FrameRecord = {
      timestamp,
      connectionId: e.requestId,
      direction,
      opcode,
      payloadSize: size,
      isJson: false,
    }

    if (isBinary) {
      binaryCount++
      totalBinaryBytes += size
      // Show first 100 chars as hex-like preview
      record.binaryPreview = payloadData.slice(0, 100)
    } else {
      textCount++
      totalTextBytes += size
      // Try JSON parse
      try {
        JSON.parse(payloadData)
        jsonCount++
        record.isJson = true
        record.jsonPreview = payloadData.slice(0, 200)
      } catch {
        record.jsonPreview = payloadData.slice(0, 200)
      }
    }

    frames.push(record)

    // Raw JSONL for pipeline compatibility
    const rawLine = JSON.stringify({
      type: 'frame',
      connectionId: e.requestId,
      timestamp,
      direction,
      opcode,
      payload: payloadData,
    })
    rawJsonlLines.push(rawLine)

    // Live log (abbreviated)
    const tag = isBinary ? 'BIN' : record.isJson ? 'JSON' : 'TXT'
    const arrow = direction === 'sent' ? '>>>' : '<<<'
    const preview = record.jsonPreview?.slice(0, 80) ?? record.binaryPreview?.slice(0, 40) ?? ''
    console.log(`  [${tag}] ${arrow} ${size}B  ${preview}`)
  }

  cdp.on('Network.webSocketFrameSent', (e: CdpWsFrame) => handleFrame(e, 'sent'))
  cdp.on('Network.webSocketFrameReceived', (e: CdpWsFrame) => handleFrame(e, 'received'))

  cdp.on('Network.webSocketClosed', (e: { requestId: string }) => {
    const line = JSON.stringify({ type: 'close', connectionId: e.requestId, timestamp: new Date().toISOString() })
    rawJsonlLines.push(line)
    console.log(`  [WS CLOSE] ${e.requestId}`)
  })

  // ── Capture ─────────────────────────────────────────────────

  console.log(`\nCapturing WS traffic for ${CAPTURE_DURATION_MS / 1000}s...\n`)
  await new Promise((r) => setTimeout(r, CAPTURE_DURATION_MS))

  // ── Summary ─────────────────────────────────────────────────

  const total = binaryCount + textCount
  console.log('\n════════════════════════════════════════')
  console.log('  WhatsApp Web WS Traffic Summary')
  console.log('════════════════════════════════════════')
  console.log(`  Connections seen: ${connections.size}`)
  console.log(`  Total frames:    ${total}`)
  console.log(`  Binary frames:   ${binaryCount} (${total ? ((binaryCount / total) * 100).toFixed(1) : 0}%)`)
  console.log(`  Text frames:     ${textCount} (${total ? ((textCount / total) * 100).toFixed(1) : 0}%)`)
  console.log(`  JSON parseable:  ${jsonCount}`)
  console.log(`  Binary bytes:    ${totalBinaryBytes}`)
  console.log(`  Text bytes:      ${totalTextBytes}`)

  console.log('\n  Connections:')
  for (const conn of connections.values()) {
    console.log(`    ${conn.requestId}: ${conn.url}`)
  }

  // Show frame size distribution
  if (frames.length > 0) {
    const sizes = frames.map((f) => f.payloadSize)
    sizes.sort((a, b) => a - b)
    console.log('\n  Frame size distribution:')
    console.log(`    Min: ${sizes[0]}B`)
    console.log(`    Median: ${sizes[Math.floor(sizes.length / 2)]}B`)
    console.log(`    Max: ${sizes[sizes.length - 1]}B`)
    console.log(`    Mean: ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(0)}B`)
  }

  // Show sample JSON frames
  const jsonFrames = frames.filter((f) => f.isJson)
  if (jsonFrames.length > 0) {
    console.log('\n  Sample JSON frames (first 5):')
    for (const f of jsonFrames.slice(0, 5)) {
      console.log(`    ${f.direction} ${f.payloadSize}B: ${f.jsonPreview?.slice(0, 120)}`)
    }
  }

  // Show sample text (non-JSON) frames
  const textNonJson = frames.filter((f) => !f.isJson && f.opcode !== 2)
  if (textNonJson.length > 0) {
    console.log('\n  Sample non-JSON text frames (first 5):')
    for (const f of textNonJson.slice(0, 5)) {
      console.log(`    ${f.direction} ${f.payloadSize}B: ${f.jsonPreview?.slice(0, 120)}`)
    }
  }

  // ── Save raw capture ────────────────────────────────────────

  mkdirSync('tmp', { recursive: true })
  writeFileSync(OUTPUT_PATH, rawJsonlLines.join('\n') + '\n')
  console.log(`\nRaw capture saved to ${OUTPUT_PATH}`)

  await cdp.detach()
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
