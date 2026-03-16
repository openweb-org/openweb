/**
 * Telegram Web A (web.telegram.org/a/) L3 adapter.
 *
 * Telegram-t uses teact (custom React-like framework) with a webpack-bundled
 * global state. State is accessed via getGlobal() found dynamically in the
 * webpack module cache. Contains chats, users, messages as plain objects.
 *
 * Key pitfall: module IDs and export names are mangled and change per deploy.
 * The adapter finds getGlobal dynamically by testing function return shapes.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright'

/** Inlined in every page.evaluate — finds teact getGlobal by walking webpack modules */
function findGetGlobal(): (() => Record<string, unknown>) | null {
  const wp = (window as Record<string, unknown>).webpackChunktelegram_t as unknown[] | undefined
  if (!wp || !Array.isArray(wp)) return null
  let require: Record<string, unknown> | null = null
  wp.push([[Symbol()], {}, (r: Record<string, unknown>) => { require = r }])
  wp.pop()
  if (!require || !(require as Record<string, unknown>).m) return null
  const moduleMap = (require as Record<string, unknown>).m as Record<string, unknown>
  for (const id of Object.keys(moduleMap)) {
    try {
      const mod = (require as (id: string) => Record<string, unknown>)(id)
      if (!mod || typeof mod !== 'object') continue
      for (const key of Object.keys(mod)) {
        if (typeof (mod as Record<string, unknown>)[key] !== 'function') continue
        try {
          const r = ((mod as Record<string, unknown>)[key] as () => Record<string, unknown>)()
          if (r && r.chats && r.users && r.currentUserId) {
            return (mod as Record<string, unknown>)[key] as () => Record<string, unknown>
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return null
}

// Serialize the function for injection into page.evaluate
const FIND_GET_GLOBAL_SRC = findGetGlobal.toString()

export default {
  name: 'telegram-protocol',
  description: 'Telegram Web A global state access via teact/webpack',
  provides: [
    { type: 'protocol', description: 'Global state via dynamic webpack getGlobal()' },
    { type: 'extraction', description: 'Chat/user/message data serialization' },
  ],

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      return Array.isArray((window as Record<string, unknown>).webpackChunktelegram_t)
    })
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate((fnSrc: string) => {
      const findFn = new Function(`return (${fnSrc})()`) as () => (() => Record<string, unknown>) | null
      const getGlobal = findFn()
      return !!getGlobal?.()?.currentUserId
    }, FIND_GET_GLOBAL_SRC)
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    switch (operation) {
      case 'getDialogs':
        return page.evaluate((args: { fnSrc: string; limit: number }) => {
          const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
          if (!getGlobal) throw new Error('getGlobal not found — Telegram state unavailable')
          const global = getGlobal() as {
            chats: { byId: Record<string, { id: string; title?: string; type: string }>; listIds?: { active?: string[] } }
            users: { byId: Record<string, { id: string; firstName?: string; lastName?: string }> }
          }
          const chats = global.chats?.byId ?? {}
          const users = global.users?.byId ?? {}
          const orderedIds = global.chats?.listIds?.active ?? Object.keys(chats)
          return orderedIds.slice(0, args.limit).map((id) => {
            const chat = chats[id]
            const user = users[id]
            return {
              id,
              title: chat?.title ?? ([user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'unknown'),
              type: chat?.type ?? 'unknown',
            }
          })
        }, { fnSrc: FIND_GET_GLOBAL_SRC, limit: (params.limit as number) ?? 50 })

      case 'getMe':
        return page.evaluate((fnSrc: string) => {
          const getGlobal = new Function(`return (${fnSrc})()`)() as (() => Record<string, unknown>) | null
          if (!getGlobal) throw new Error('getGlobal not found')
          const global = getGlobal() as {
            currentUserId: string
            users: { byId: Record<string, { id: string; firstName?: string; lastName?: string; usernames?: Array<{ username: string }> }> }
          }
          const userId = global.currentUserId
          const user = global.users?.byId?.[userId]
          return {
            id: userId,
            firstName: user?.firstName,
            lastName: user?.lastName,
            username: user?.usernames?.[0]?.username,
          }
        }, FIND_GET_GLOBAL_SRC)

      case 'getMessages':
        return page.evaluate((args: { fnSrc: string; chatId: string; limit: number }) => {
          const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
          if (!getGlobal) throw new Error('getGlobal not found')
          const global = getGlobal() as {
            messages: { byChatId: Record<string, { byId: Record<string, { id: number; chatId: string; date: number; content?: { text?: { text?: string } } }> }> }
          }
          const chatMsgs = global.messages?.byChatId?.[args.chatId]?.byId
          if (!chatMsgs) return []
          const msgIds = Object.keys(chatMsgs).sort((a, b) => Number(b) - Number(a)).slice(0, args.limit)
          return msgIds.map((id) => {
            const msg = chatMsgs[id]!
            return {
              id: msg.id,
              chatId: msg.chatId,
              date: msg.date,
              text: msg.content?.text?.text ?? '',
            }
          })
        }, { fnSrc: FIND_GET_GLOBAL_SRC, chatId: params.chatId as string, limit: (params.limit as number) ?? 50 })

      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  },
} satisfies CodeAdapter
