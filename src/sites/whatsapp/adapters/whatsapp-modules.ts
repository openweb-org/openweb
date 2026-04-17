/**
 * WhatsApp Web L3 adapter — accesses internal Metro-style module system.
 *
 * WhatsApp Web uses Meta's proprietary module system (__d/__w/require).
 * Data lives in Backbone-style collections accessible via require('WAWeb*').
 * No REST/GraphQL API exists — all data goes through internal modules.
 *
 * Write ops use WAWebSendTextMsgChatAction.sendTextMsgToChat (send) and
 * chat.deleteMessages() (delete) — zero DOM, zero selectors.
 */
import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

// ── preamble ────────────────────────────────────────────────────
// WhatsApp Web's Metro module system (`require`) is loaded dynamically after
// page settle. Wait for `WAWebChatCollection` to be require-able, then verify
// at least one chat is populated (proxy for valid session).

async function ensureReady(page: Page, helpers: AdapterHelpers): Promise<void> {
  const moduleReady = await page.evaluate(() => {
    try {
      return typeof (window as Record<string, unknown>).require === 'function'
        && !!(window as Record<string, unknown>).require('WAWebChatCollection' as never)
    } catch {
      return false
    }
  })
  if (!moduleReady) throw helpers.errors.retriable('WhatsApp internal modules not loaded')

  const authed = await page.evaluate(() => {
    try {
      const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
      const col = req('WAWebChatCollection').ChatCollection as { getModelsArray?: () => unknown[] }
      return (col?.getModelsArray?.()?.length ?? 0) > 0
    } catch {
      return false
    }
  })
  if (!authed) throw helpers.errors.needsLogin()
}

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async getChats(page, params) {
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
  },

  async getMessages(page, params) {
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
  },

  async getContacts(page, params) {
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
  },

  async getChatById(page, params) {
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
  },

  async searchChats(page, params) {
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
  },

  async sendMessage(page, params) {
    return sendMessage(page, params.chatId as string, params.message as string)
  },

  async deleteMessage(page, params) {
    return deleteMessage(page, params.chatId as string, params.messageId as string)
  },

  async markAsRead(page, params) {
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
  },
}

const runner: CustomRunner = {
  name: 'whatsapp-modules',
  description: 'WhatsApp Web internal module access for chat/contact/message data',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('whatsapp-modules requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    try {
      await ensureReady(page, helpers)
      return await handler(page, params, helpers)
    } catch (error) {
      throw helpers.errors.wrap(error)
    }
  },
}

export default runner

// ── sendMessage ─────────────────────────────────────────────────
// Uses WAWebSendTextMsgChatAction.sendTextMsgToChat — direct internal
// module call via page.evaluate. Zero DOM, zero selectors.
// Returns {messageSendResult, t} from the internal WS round-trip.

async function sendMessage(
  page: Page,
  chatId: string,
  message: string,
): Promise<{ success: boolean; timestamp: number }> {
  return page.evaluate(
    (args: { chatId: string; message: string }) => {
      const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
      const col = req('WAWebChatCollection').ChatCollection as {
        getModelsArray: () => Array<Record<string, unknown>>
      }
      const chat = col.getModelsArray().find(
        (c) => (c.id as Record<string, unknown>)?._serialized === args.chatId,
      )
      if (!chat) throw new Error(`Chat not found: ${args.chatId}`)

      const sendMod = req('WAWebSendTextMsgChatAction') as {
        sendTextMsgToChat: (chat: unknown, text: string, opts: Record<string, unknown>) => Promise<{ messageSendResult: string; t: number }>
      }

      return sendMod.sendTextMsgToChat(chat, args.message, {}).then((result) => ({
        success: result.messageSendResult === 'OK',
        timestamp: result.t ?? 0,
      }))
    },
    { chatId, message },
  )
}

// ── deleteMessage ──────────────────────────────────────────────
// Uses internal chat.deleteMessages() which calls deleteMsgsPartial →
// msg.delete() under the hood ("delete for me").

async function deleteMessage(
  page: Page,
  chatId: string,
  messageId: string,
): Promise<{ success: boolean }> {
  return page.evaluate(
    (args: { chatId: string; messageId: string }) => {
      const req = (window as Record<string, unknown>).require as (m: string) => Record<string, unknown>
      const col = req('WAWebChatCollection').ChatCollection as {
        getModelsArray: () => Array<Record<string, unknown>>
      }
      const chat = col.getModelsArray().find(
        (c) => (c.id as Record<string, unknown>)?._serialized === args.chatId,
      ) as Record<string, unknown> | undefined
      if (!chat) throw new Error(`Chat not found: ${args.chatId}`)

      const msgs = chat.msgs as { getModelsArray: () => Array<Record<string, unknown>> }
      const msg = msgs.getModelsArray().find(
        (m) => (m.id as Record<string, unknown>)?._serialized === args.messageId,
      )
      if (!msg) return { success: true } // idempotent: already deleted or not in store

      // chat.deleteMessages([serializedId]) — internal "delete for me"
      const deleteMessages = chat.deleteMessages as (ids: string[]) => void
      deleteMessages.call(chat, [args.messageId])
      return { success: true }
    },
    { chatId, messageId },
  )
}
