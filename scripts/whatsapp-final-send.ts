/**
 * Send test messages via compose box + capture WS traffic + read from Store.
 *
 * SAFETY: ONLY contact 13472225726@c.us (+1 347-222-5726)
 * Prerequisite: Run whatsapp-navigate-chat.ts first to open the chat.
 *
 * Usage: npx tsx scripts/whatsapp-final-send.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CDP_PORT = process.env.OPENWEB_CDP_PORT ?? '9222'
const SAFE_CONTACT_ID = '13472225726@c.us'

async function main(): Promise<void> {
  console.log(`Connecting to Chrome CDP on port ${CDP_PORT}...`)
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)

  let whatsappPage = null
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes('web.whatsapp.com')) { whatsappPage = page; break }
    }
    if (whatsappPage) break
  }
  if (!whatsappPage) { console.error('No WhatsApp tab'); process.exit(1) }

  // Verify we're in the right chat
  const headerText = await whatsappPage.evaluate(() => {
    const h = document.querySelector('header span[dir="auto"]')
    return h?.textContent ?? ''
  })
  console.log(`Chat header: "${headerText}"`)
  if (!headerText.includes('347') || !headerText.includes('222-5726')) {
    console.error('SAFETY: Not in the correct chat! Aborting.')
    process.exit(1)
  }

  // ── Set up WS capture ───────────────────────────────────────

  const cdp = await whatsappPage.context().newCDPSession(whatsappPage)
  await cdp.send('Network.enable')

  interface WsFrame {
    direction: 'sent' | 'received'
    opcode: number
    size: number
    ts: string
    payloadPreview: string
  }
  const wsFrames: WsFrame[] = []

  const handleFrame = (e: any, direction: 'sent' | 'received') => {
    const { opcode, payloadData } = e.response
    wsFrames.push({
      direction,
      opcode,
      size: payloadData.length,
      ts: new Date().toISOString(),
      payloadPreview: payloadData.slice(0, 60),
    })
  }
  cdp.on('Network.webSocketFrameSent', (e: any) => handleFrame(e, 'sent'))
  cdp.on('Network.webSocketFrameReceived', (e: any) => handleFrame(e, 'received'))

  // ── Send test messages ──────────────────────────────────────

  const messages = ['openweb test 1', 'openweb test 2', 'openweb test 3']
  const composeSelector = 'div[contenteditable="true"][data-tab="10"]'

  console.log('\nSending test messages...\n')

  for (const text of messages) {
    const framesBefore = wsFrames.length

    const box = await whatsappPage.$(composeSelector)
    if (!box) {
      console.log(`  ERROR: compose box not found for "${text}"`)
      continue
    }

    await box.click()
    await whatsappPage.waitForTimeout(200)
    await whatsappPage.keyboard.type(text, { delay: 20 })
    await whatsappPage.waitForTimeout(200)
    await whatsappPage.keyboard.press('Enter')

    // Wait for WS frames
    await whatsappPage.waitForTimeout(2000)

    const newFrames = wsFrames.length - framesBefore
    console.log(`  "${text}" — sent! (${newFrames} WS frames)`)
  }

  // Wait for all responses
  console.log('\nWaiting 5s for responses...')
  await whatsappPage.waitForTimeout(5000)

  // ── Read messages from Store ────────────────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  MESSAGES IN STORE')
  console.log('═══════════════════════════════════════════\n')

  const storeMessages = await whatsappPage.evaluate((contactId) => {
    // @ts-ignore
    const { ChatCollection } = require('WAWebChatCollection')
    const chats = ChatCollection.getModelsArray()
    const chat = chats.find((c: any) => (c.id?._serialized ?? '') === contactId)
    if (!chat) return { error: 'chat not found' }

    const msgs = chat.msgs?.getModelsArray?.() ?? []
    return {
      count: msgs.length,
      messages: msgs.map((m: any) => ({
        type: m.type ?? '?',
        body: m.body ?? '[no body]',
        t: m.t ?? 0,
        fromMe: m.id?.fromMe ?? false,
        ack: m.ack ?? -1,
      })),
    }
  }, SAFE_CONTACT_ID)

  console.log(`  Total: ${storeMessages.count ?? storeMessages.error}`)
  if (storeMessages.messages) {
    for (const msg of storeMessages.messages) {
      const dir = msg.fromMe ? '>>>' : '<<<'
      const ts = msg.t ? new Date(msg.t * 1000).toISOString().slice(0, 19) : '?'
      console.log(`    ${dir} [${msg.type}] ${ts} | ${msg.body} (ack=${msg.ack})`)
    }
  }

  // ── Read messages from DOM ──────────────────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  MESSAGES IN DOM')
  console.log('═══════════════════════════════════════════\n')

  const domMsgs = await whatsappPage.evaluate(() => {
    const msgs: Array<{text: string, isOut: boolean}> = []
    // Try multiple selector strategies
    document.querySelectorAll('[data-testid="msg-container"]').forEach(el => {
      const text = el.querySelector('span.selectable-text')?.textContent
        ?? el.querySelector('[data-testid="msg-text"]')?.textContent
        ?? el.textContent?.trim().slice(0, 100) ?? '[no text]'
      const isOut = !!el.closest('.message-out')
      msgs.push({ text: text.slice(0, 100), isOut })
    })

    // Fallback: scan copyable-text spans
    if (msgs.length === 0) {
      document.querySelectorAll('span[data-testid], span.copyable-text').forEach(el => {
        const text = el.textContent?.trim()
        if (text && text.length > 0 && text.length < 200 && !text.includes('Type a message')) {
          msgs.push({ text, isOut: false })
        }
      })
    }

    return msgs
  })

  for (const msg of domMsgs) {
    const dir = msg.isOut ? '>>>' : '<<<'
    console.log(`    ${dir} ${msg.text}`)
  }

  // ── Take screenshot ─────────────────────────────────────────

  await whatsappPage.screenshot({ path: 'tmp/whatsapp-after-send.png' })
  console.log('\nScreenshot saved: tmp/whatsapp-after-send.png')

  // ── WS traffic summary ─────────────────────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  WS TRAFFIC SUMMARY')
  console.log('═══════════════════════════════════════════\n')

  console.log(`  Total frames: ${wsFrames.length}`)
  console.log(`    Sent: ${wsFrames.filter(f => f.direction === 'sent').length}`)
  console.log(`    Received: ${wsFrames.filter(f => f.direction === 'received').length}`)
  console.log(`    Binary: ${wsFrames.filter(f => f.opcode === 2).length}`)
  console.log(`    Text: ${wsFrames.filter(f => f.opcode === 1).length}`)

  if (wsFrames.length > 0) {
    const sizes = wsFrames.map(f => f.size)
    console.log(`\n  Frame sizes: min=${Math.min(...sizes)} max=${Math.max(...sizes)} avg=${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`)
  }

  // ── Save all data ───────────────────────────────────────────

  mkdirSync('tmp', { recursive: true })
  writeFileSync('tmp/whatsapp-final-capture.json', JSON.stringify({
    wsFrames,
    storeMessages: storeMessages.messages,
    domMessages: domMsgs,
  }, null, 2))
  console.log('\nCapture data saved to tmp/whatsapp-final-capture.json')

  await cdp.detach()
  await browser.close()
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
