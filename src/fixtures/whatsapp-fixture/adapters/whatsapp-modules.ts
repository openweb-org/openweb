/**
 * WhatsApp Web L3 adapter — accesses internal module system via require().
 *
 * WhatsApp Web uses Meta's proprietary module system (__d/__w/require).
 * Data lives in Backbone-style collections accessible via require('WAWeb*Collection').
 * There is no REST/GraphQL API — all data access goes through these internal modules.
 */
import { OpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright'

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
  provides: [
    { type: 'protocol', description: 'Internal collections via Meta require() module system' },
    { type: 'extraction', description: 'Chat/contact/message serialization' },
  ],

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

        default:
          throw fatalAdapterError(`Unknown operation: ${operation}`)
      }
    } catch (error) {
      throw normalizeWhatsAppError(error)
    }
  },
} satisfies CodeAdapter
