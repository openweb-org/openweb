import type { Page, Response as PwResponse } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * ChatGPT SPA adapter.
 *
 * sendMessage cannot be replayed via direct HTTP: chatgpt.com gates
 * `/backend-api/f/conversation` behind a Sentinel chat-requirements token
 * and a SHA3-512 proof-of-work challenge whose seed binds to the browser
 * fingerprint. Direct POSTs (Node fetch or even page.evaluate(fetch))
 * return 403 "Unusual activity has been detected from your device."
 *
 * The SPA itself solves the challenge on every send. This adapter drives
 * the React composer with synthesized keyboard events (no DOM clicks),
 * lets the SPA do the cryptography, and intercepts the resulting SSE
 * response off the wire.
 */

const COMPOSER_SELECTOR = '#prompt-textarea'
const SEND_RESPONSE_TIMEOUT_MS = 60_000
const SEND_URL_MATCH = /\/backend-api\/f\/conversation(?!\/prepare)(?:$|\?)/
const CONVERSATION_URL_MATCH = /\/c\/([0-9a-f-]{36})/

type Errors = {
  missingParam(name: string): Error
  unknownOp(op: string): Error
  apiError(label: string, message: string): Error
  fatal(message: string): Error
  wrap(error: unknown): Error
}

function extractAssistantText(sse: string): string {
  const out: string[] = []
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const event = JSON.parse(payload) as Record<string, unknown>
      const v = event.v
      if (typeof v === 'string') {
        out.push(v)
      } else if (Array.isArray(v)) {
        for (const entry of v as Array<Record<string, unknown>>) {
          if (entry?.p === '/message/content/parts/0' && typeof entry.v === 'string') {
            out.push(entry.v)
          }
        }
      }
    } catch { /* non-JSON SSE frame (heartbeat, comment) */ }
  }
  return out.join('')
}

async function sendMessage(
  page: Page,
  params: Record<string, unknown>,
  errors: Errors,
): Promise<unknown> {
  const prompt = String(params.prompt ?? '').trim()
  if (!prompt) throw errors.missingParam('prompt')

  // Land on chatgpt.com root. page_plan handles entry_url, but adapter is
  // responsible if the runtime navigated to a non-root URL or stayed on
  // a previous conversation.
  if (!/^https:\/\/chatgpt\.com\/(?:$|\?|c\/)/.test(page.url())) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  }
  await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 20_000 }).catch(() => {})

  // Capture the SSE response body. Listener registered before keypress so
  // an early response is not missed.
  let responsePromise: Promise<string> | null = null
  const handler = (resp: PwResponse) => {
    if (responsePromise) return
    if (!SEND_URL_MATCH.test(resp.url())) return
    responsePromise = resp.text().catch(() => '')
  }
  page.on('response', handler)

  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el) el.focus()
    }, COMPOSER_SELECTOR)
    await page.keyboard.type(prompt)
    await page.keyboard.press('Enter')

    const start = Date.now()
    while (!responsePromise && Date.now() - start < SEND_RESPONSE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 250))
    }
    if (!responsePromise) {
      throw errors.apiError('sendMessage', 'No /backend-api/f/conversation response within timeout')
    }
    const sse = await responsePromise

    // Conversation id surfaces in the URL once the SPA navigates.
    let conversationId: string | null = null
    const navStart = Date.now()
    while (!conversationId && Date.now() - navStart < 10_000) {
      const m = page.url().match(CONVERSATION_URL_MATCH)
      if (m?.[1]) { conversationId = m[1]; break }
      await new Promise((r) => setTimeout(r, 250))
    }

    const responseText = extractAssistantText(sse)
    return {
      conversation_id: conversationId,
      response_text: responseText,
      sse_event_count: sse.split('\n').filter((l) => l.startsWith('data:')).length,
    }
  } finally {
    page.off('response', handler)
  }
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>
> = {
  sendMessage,
}

const adapter: CustomRunner = {
  name: 'chatgpt-web',
  description: 'ChatGPT SPA adapter — sendMessage drives the composer so the page solves Sentinel + PoW.',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as { errors: Errors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (!page) throw errors.fatal('chatgpt-web adapter requires a browser page (transport: page).')
    return handler(page, { ...params }, errors)
  },

  async warmReady(page) {
    return await page.evaluate((sel) => !!document.querySelector(sel), COMPOSER_SELECTOR).catch(() => false)
  },
  warmTimeoutMs: 20_000,
}

export default adapter
