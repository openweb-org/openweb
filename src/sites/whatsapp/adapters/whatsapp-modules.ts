/**
 * WhatsApp Web L3 adapter — accesses internal module system via require().
 *
 * WhatsApp Web uses Meta's proprietary module system (__d/__w/require).
 * Data lives in Backbone-style collections accessible via require('WAWeb*Collection').
 * There is no REST/GraphQL API — all data access goes through these internal modules.
 */
import { OpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

function fatalAdapterError(message: string): OpenWebError {
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message,
    action: 'Check the operation name or input parameters.',
    retriable: false,
    failureClass: 'fatal',
  })
}

function normalizeWhatsAppError(error: unknown): OpenWebError {
  if (error instanceof OpenWebError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Unknown operation:') || message.startsWith('Chat not found:')) {
    return fatalAdapterError(message)
  }

  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message,
    action: 'Retry after WhatsApp Web finishes loading.',
    retriable: true,
    failureClass: 'retriable',
  })
}

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

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
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
          throw fatalAdapterError(`Unknown operation: ${operation}`)
      }
    } catch (error) {
      throw normalizeWhatsAppError(error)
    }
  },
} satisfies CodeAdapter

// ── sendMessage ─────────────────────────────────────────────────
// Uses Playwright keyboard to type into the compose box and press Enter.
// This is the proven approach — Store-level addAndSendMsgToChat silently
// drops messages in the adapter execution context.

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

  // 2. Wait for compose box to appear
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
