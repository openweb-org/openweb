/**
 * WhatsApp Web L3 adapter — accesses internal Metro-style module system.
 *
 * WhatsApp Web uses Meta's proprietary module system (__d/__w/require).
 * Data lives in Backbone-style collections accessible via require('WAWeb*').
 * No REST/GraphQL API exists — all data goes through internal modules.
 */
import type { Page } from 'patchright'

export default {
  name: 'whatsapp-modules',
  description: 'WhatsApp Web internal module access for chat/contact/message data',

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        return typeof (window as Record<string, unknown>).require === 'function'
          && !!(window as Record<string, unknown>).require('WAWebChatCollection' as never)
      } catch {
        return false
      }
    })
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
        const col = req('WAWebChatCollection').ChatCollection as { getModelsArray?: () => unknown[] }
        return (col?.getModelsArray?.()?.length ?? 0) > 0
      } catch {
        return false
      }
    })
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers): Promise<unknown> {
    const { errors } = helpers
    try {
      switch (operation) {
        case 'getChats':
          return page.evaluate((limit: number) => {
            const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
            const col = req('WAWebChatCollection').ChatCollection as {
              getModelsArray: () => Array<Record<string, unknown>>
            }
            return col.getModelsArray().slice(0, limit).map((c) => ({
              id: (c.id as Record<string, unknown>)?._serialized ?? String(c.id),
              name: c.name ?? c.formattedTitle ?? 'unnamed',
              isGroup: c.isGroup ?? false,
              unreadCount: c.unreadCount ?? 0,
              timestamp: c.t ?? null,
            }))
          }, (params.limit as number) ?? 50)

        case 'getMessages':
          return page.evaluate(
            (args: { chatId: string; limit: number }) => {
              const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
              const col = req('WAWebChatCollection').ChatCollection as {
                getModelsArray: () => Array<Record<string, unknown>>
              }
              const chat = col.getModelsArray().find(
                (c) => (c.id as Record<string, unknown>)?._serialized === args.chatId,
              )
              if (!chat) throw new Error(`Chat not found: ${args.chatId}`)
              const msgs = chat.msgs as { getModelsArray: () => Array<Record<string, unknown>> }
              return msgs.getModelsArray().slice(-args.limit).map((m) => ({
                id: (m.id as Record<string, unknown>)?._serialized ?? String(m.id),
                fromMe: (m.id as Record<string, unknown>)?.fromMe ?? false,
                body: typeof m.body === 'string' ? m.body.substring(0, 500) : '',
                timestamp: m.t ?? null,
                type: m.type ?? 'unknown',
              }))
            },
            { chatId: params.chatId as string, limit: (params.limit as number) ?? 50 },
          )

        case 'getContacts':
          return page.evaluate((limit: number) => {
            const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
            const col = req('WAWebContactCollection').ContactCollection as {
              getModelsArray: () => Array<Record<string, unknown>>
            }
            return col.getModelsArray().slice(0, limit).map((c) => ({
              id: (c.id as Record<string, unknown>)?._serialized ?? String(c.id),
              name: c.name ?? c.pushname ?? 'unnamed',
              isMe: c.isMe ?? false,
            }))
          }, (params.limit as number) ?? 100)

        case 'getChatById':
          return page.evaluate((chatId: string) => {
            const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
            const col = req('WAWebChatCollection').ChatCollection as {
              getModelsArray: () => Array<Record<string, unknown>>
            }
            const c = col.getModelsArray().find(
              (ch) => (ch.id as Record<string, unknown>)?._serialized === chatId,
            )
            if (!c) throw new Error(`Chat not found: ${chatId}`)
            return {
              id: (c.id as Record<string, unknown>)?._serialized ?? String(c.id),
              name: c.name ?? c.formattedTitle ?? 'unnamed',
              isGroup: c.id && (c.id as Record<string, unknown>).server === 'g.us',
              unreadCount: Math.max(0, (c.unreadCount as number) ?? 0),
              timestamp: c.t ?? null,
              archived: c.archive ?? false,
              pinned: typeof c.pin === 'number' && (c.pin as number) > 0,
              muted: typeof c.muteExpiration === 'number' && (c.muteExpiration as number) > 0,
              lastMessage: (() => {
                const msgs = c.msgs as { getModelsArray?: () => Array<Record<string, unknown>> } | undefined
                const last = msgs?.getModelsArray?.().at(-1)
                if (!last) return null
                return {
                  body: typeof last.body === 'string' ? last.body.substring(0, 200) : '',
                  fromMe: (last.id as Record<string, unknown>)?.fromMe ?? false,
                  timestamp: last.t ?? null,
                }
              })(),
            }
          }, params.chatId as string)

        case 'searchChats':
          return page.evaluate(
            (args: { query: string; limit: number }) => {
              const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
              const col = req('WAWebChatCollection').ChatCollection as {
                getModelsArray: () => Array<Record<string, unknown>>
              }
              const q = args.query.toLowerCase()
              return col.getModelsArray()
                .filter((c) => {
                  const name = String(c.name ?? c.formattedTitle ?? '').toLowerCase()
                  const id = String((c.id as Record<string, unknown>)?._serialized ?? '')
                  return name.includes(q) || id.includes(q)
                })
                .slice(0, args.limit)
                .map((c) => ({
                  id: (c.id as Record<string, unknown>)?._serialized ?? String(c.id),
                  name: c.name ?? c.formattedTitle ?? 'unnamed',
                  isGroup: c.id && (c.id as Record<string, unknown>).server === 'g.us',
                  unreadCount: c.unreadCount ?? 0,
                  timestamp: c.t ?? null,
                }))
            },
            { query: params.query as string, limit: (params.limit as number) ?? 20 },
          )

        case 'sendMessage':
          return sendMessage(page, params.chatId as string, params.message as string)

        case 'deleteMessage':
          return deleteMessage(page, params.chatId as string, params.messageId as string)

        case 'markAsRead':
          return page.evaluate(
            (args: { chatId: string; read: boolean }) => {
              const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
              const chatCol = req('WAWebChatCollection').ChatCollection as {
                getModelsArray: () => Array<Record<string, unknown>>
              }
              const chat = chatCol.getModelsArray().find(
                (c) => (c.id as Record<string, unknown>)?._serialized === args.chatId,
              )
              if (!chat) throw new Error(`Chat not found: ${args.chatId}`)
              const bridge = req('WAWebChatSeenBridge') as Record<string, (...a: unknown[]) => Promise<unknown>>
              if (args.read) {
                bridge.markConversationSeen(chat.id, 0)
              } else {
                bridge.markConversationUnseen(chat.id)
              }
              return { success: true }
            },
            { chatId: params.chatId as string, read: (params.read as boolean) ?? true },
          )

        default:
          throw errors.unknownOp(operation)
      }
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

// ── sendMessage ─────────────────────────────────────────────────
// Uses Playwright keyboard to type into the compose box and press Enter.
// Store-level addAndSendMsgToChat silently drops messages in the adapter
// execution context, so DOM interaction is the reliable approach.

const COMPOSE_SELECTOR = 'div[contenteditable="true"][data-tab="10"]'

async function sendMessage(
  page: Page,
  chatId: string,
  message: string,
): Promise<{ success: boolean; timestamp: number }> {
  // 1. Open the chat via internal command
  await page.evaluate((id: string) => {
    const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
    const col = req('WAWebChatCollection').ChatCollection as {
      getModelsArray: () => Array<Record<string, unknown>>
    }
    const chat = col.getModelsArray().find(
      (c) => (c.id as Record<string, unknown>)?._serialized === id,
    )
    if (!chat) throw new Error(`Chat not found: ${id}`)
    const cmd = req('WAWebCmd') as { Cmd: { openChatBottom: (opts: { chat: unknown }) => void } }
    cmd.Cmd.openChatBottom({ chat })
  }, chatId)

  // 2. Wait for compose box
  await page.waitForSelector(COMPOSE_SELECTOR, { timeout: 5000 })
  await page.click(COMPOSE_SELECTOR)
  await page.waitForTimeout(200)

  // 3. Type message and send
  await page.keyboard.type(message, { delay: 20 })
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')

  // 4. Wait for WS round-trip
  await page.waitForTimeout(2000)

  // 5. Verify via Store
  return page.evaluate((id: string) => {
    const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
    const col = req('WAWebChatCollection').ChatCollection as {
      getModelsArray: () => Array<Record<string, unknown>>
    }
    const chat = col.getModelsArray().find(
      (c) => (c.id as Record<string, unknown>)?._serialized === id,
    )
    if (!chat) return { success: false, timestamp: 0 }
    const msgs = (chat.msgs as { getModelsArray: () => Array<Record<string, unknown>> }).getModelsArray()
    const last = msgs.at(-1)
    if (!last || !(last.id as Record<string, unknown>)?.fromMe) {
      return { success: false, timestamp: 0 }
    }
    return {
      success: true,
      timestamp: (last.t as number) ?? 0,
    }
  }, chatId)
}

// ── deleteMessage ──────────────────────────────────────────────
// Reverse of sendMessage. Opens the chat, hovers over the target message
// to reveal the dropdown arrow, clicks it, selects "Delete message",
// and confirms via the "Delete for me" button.

async function deleteMessage(
  page: Page,
  chatId: string,
  messageId: string,
): Promise<{ success: boolean }> {
  // 1. Open the chat
  await page.evaluate((id: string) => {
    const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
    const col = req('WAWebChatCollection').ChatCollection as {
      getModelsArray: () => Array<Record<string, unknown>>
    }
    const chat = col.getModelsArray().find(
      (c) => (c.id as Record<string, unknown>)?._serialized === id,
    )
    if (!chat) throw new Error(`Chat not found: ${id}`)
    const cmd = req('WAWebCmd') as { Cmd: { openChatBottom: (opts: { chat: unknown }) => void } }
    cmd.Cmd.openChatBottom({ chat })
  }, chatId)

  await page.waitForTimeout(1000)

  // 2. Find the target message element by data-id attribute
  const msgSelector = `div.message-out[data-id="${messageId}"], div.message-in[data-id="${messageId}"]`
  const msgEl = await page.waitForSelector(msgSelector, { timeout: 5000 })
  if (!msgEl) throw new Error(`Message element not found: ${messageId}`)

  // 3. Hover over message to reveal the dropdown arrow
  await msgEl.hover()
  await page.waitForTimeout(300)

  // 4. Click the dropdown arrow (appears on hover)
  const arrowSelector = `div.message-out[data-id="${messageId}"] span[data-icon="down-context"], div.message-in[data-id="${messageId}"] span[data-icon="down-context"]`
  const arrow = await page.waitForSelector(arrowSelector, { timeout: 3000 })
  if (!arrow) throw new Error('Dropdown arrow not found')
  await arrow.click()
  await page.waitForTimeout(300)

  // 5. Click "Delete message" in the context menu
  const menuItems = await page.$$('div[role="application"] li[data-animate-dropdown-item="true"]')
  let deleteItem: Awaited<ReturnType<typeof page.$>> = null
  for (const item of menuItems) {
    const text = await item.textContent()
    if (text?.includes('Delete')) {
      deleteItem = item
      break
    }
  }
  if (!deleteItem) throw new Error('"Delete" option not found in context menu')
  await deleteItem.click()
  await page.waitForTimeout(500)

  // 6. Click "Delete for me" confirmation button
  const confirmBtn = await page.waitForSelector(
    'div[data-animate-modal-popup="true"] div[role="button"]:has-text("Delete for me")',
    { timeout: 3000 },
  )
  if (!confirmBtn) throw new Error('"Delete for me" button not found')
  await confirmBtn.click()
  await page.waitForTimeout(1000)

  return { success: true }
}
