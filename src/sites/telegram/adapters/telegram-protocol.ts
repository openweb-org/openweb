/**
 * Telegram Web L3 runner.
 *
 * Reads via getGlobal() (webpack state), writes via callApi() (GramJS Worker).
 * Zero DOM manipulation — all ops go through the webpack module cache.
 *
 * Supports Web A (/a/ — teact, webpackChunktelegram_t) and
 * Web K (/k/ — webpackChunkwebk). Module IDs are mangled per deploy;
 * the runner finds getGlobal/callApi dynamically by testing return shapes
 * and scanning module source for known string constants.
 */

import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

// ── Webpack finders (serialized into page.evaluate) ───────────────

function findGetGlobal(): (() => Record<string, unknown>) | null {
  const w = window as Record<string, unknown>
  const wp = (w.webpackChunktelegram_t ?? w.webpackChunkwebk) as unknown[] | undefined
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
          if (r && typeof r === 'object' && 'chats' in r && 'users' in r) {
            return (mod as Record<string, unknown>)[key] as () => Record<string, unknown>
          }
        } catch { /* may throw */ }
      }
    } catch { /* may throw */ }
  }
  return null
}

function findCallApi(): ((...args: unknown[]) => Promise<unknown>) | null {
  const w = window as Record<string, unknown>
  const wp = (w.webpackChunktelegram_t ?? w.webpackChunkwebk) as unknown[] | undefined
  if (!wp || !Array.isArray(wp)) return null
  let require: Record<string, unknown> | null = null
  wp.push([[Symbol()], {}, (r: Record<string, unknown>) => { require = r }])
  wp.pop()
  if (!require || !(require as Record<string, unknown>).m) return null
  const moduleMap = (require as Record<string, unknown>).m as Record<string, unknown>
  for (const id of Object.keys(moduleMap)) {
    const src = (moduleMap[id] as () => void).toString()
    if (!src.includes('callMethod') || !src.includes('cancelApiProgress')) continue
    try {
      const mod = (require as (id: string) => Record<string, unknown>)(id)
      if (!mod || typeof mod !== 'object') continue
      for (const key of Object.keys(mod)) {
        const fn = (mod as Record<string, unknown>)[key]
        if (typeof fn !== 'function') continue
        const fnSrc = (fn as () => void).toString()
        if (fnSrc.includes('callMethod') && fnSrc.includes('name:')) {
          return fn as (...args: unknown[]) => Promise<unknown>
        }
      }
    } catch { /* may throw */ }
  }
  return null
}

const FIND_GET_GLOBAL_SRC = findGetGlobal.toString()
const FIND_CALL_API_SRC = findCallApi.toString()

/**
 * Locate Telegram Web A's getActions(): a 0-arg function returning a Proxy
 * that dispatches `openChat`/`loadFullUser`/etc. through addActionHandler
 * (populates BOTH teact global AND the GramJS Worker entity cache).
 *
 * Strategy: scan modules whose source mentions `addActionHandler`; for each,
 * call every 0-arg exported function and check whether the returned object
 * exposes a callable `openChat` property (Proxy traps make own-key
 * enumeration empty, but property access still returns a function).
 */
function findGetActions(): (() => Record<string, (arg?: unknown) => unknown>) | null {
  const w = window as Record<string, unknown>
  const wp = (w.webpackChunktelegram_t ?? w.webpackChunkwebk) as unknown[] | undefined
  if (!wp || !Array.isArray(wp)) return null
  let require: Record<string, unknown> | null = null
  wp.push([[Symbol()], {}, (r: Record<string, unknown>) => { require = r }])
  wp.pop()
  if (!require || !(require as Record<string, unknown>).m) return null
  const moduleMap = (require as Record<string, unknown>).m as Record<string, unknown>
  for (const id of Object.keys(moduleMap)) {
    let src: string
    try { src = (moduleMap[id] as () => void).toString() } catch { continue }
    if (!src.includes('addActionHandler')) continue
    try {
      const mod = (require as (id: string) => Record<string, unknown>)(id)
      if (!mod || typeof mod !== 'object') continue
      for (const key of Object.keys(mod)) {
        const fn = (mod as Record<string, unknown>)[key]
        if (typeof fn !== 'function' || (fn as () => void).length !== 0) continue
        try {
          const r = (fn as () => Record<string, unknown>)()
          if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).openChat === 'function') {
            return fn as () => Record<string, (arg?: unknown) => unknown>
          }
        } catch { /* may throw */ }
      }
    } catch { /* may throw */ }
  }
  return null
}

const FIND_GET_ACTIONS_SRC = findGetActions.toString()

// ── Shared helpers for page.evaluate ──────────────────────────────

/** Bootstraps getGlobal + callApi inside page.evaluate and resolves chatId */
function resolveCtx(globalSrc: string, apiSrc: string, chatId: string) {
  const getGlobal = new Function(`return (${globalSrc})()`)() as (() => Record<string, unknown>) | null
  if (!getGlobal) throw new Error('getGlobal not found')
  const callApi = new Function(`return (${apiSrc})()`)() as ((...a: unknown[]) => Promise<unknown>) | null
  if (!callApi) throw new Error('callApi not found')
  const global = getGlobal() as {
    currentUserId?: string
    chats: { byId: Record<string, Record<string, unknown>> }
    users: { byId: Record<string, { id: string; phoneNumber?: string }> }
    messages: { byChatId: Record<string, { byId: Record<string, { id: number; isOutgoing?: boolean; content?: { text?: { text?: string } } }> }> }
  }

  let peerId = chatId
  if (peerId === 'me') {
    if (!global.currentUserId) throw new Error('Not authenticated')
    peerId = global.currentUserId
  } else if (peerId.startsWith('+')) {
    const phone = peerId.replace(/\D/g, '')
    const found = Object.values(global.users?.byId ?? {}).find(u => u.phoneNumber?.replace(/\D/g, '') === phone)
    if (!found) throw new Error(`User with phone ${peerId} not found`)
    peerId = found.id
  }

  let chat = global.chats?.byId?.[peerId]
  if (!chat && peerId === global.currentUserId) {
    // Saved Messages — chat may not be in chats.byId if user has never opened
    // it. Synthesize a self-chat from users.byId[currentUserId] so callApi can
    // build InputPeerSelf. TG Web A ignores post-boot hash navigation, so we
    // can't lazy-load the chat by visiting its URL.
    const u = global.users?.byId?.[peerId]
    if (u) chat = { ...(u as Record<string, unknown>), id: peerId, type: 'chatTypePrivate' }
  }
  if (!chat) throw new Error(`Chat ${peerId} not found in state`)

  return { getGlobal, callApi, global, chat, peerId }
}

const RESOLVE_CTX_SRC = resolveCtx.toString()

// ── Read operations (getGlobal) ───────────────────────────────────

type Errors = AdapterHelpers['errors']

async function getChats(page: Page, params: Readonly<Record<string, unknown>>) {
  const limit = Number(params.limit) || 50
  return page.evaluate((args: { fnSrc: string; limit: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      currentUserId?: string
      chats: { byId: Record<string, { id: string; title?: string; type: string; membersCount?: number; unreadCount?: number; lastMessage?: { date?: number } }>
        listIds?: { active?: string[] } }
      users: { byId: Record<string, { id: string; firstName?: string; lastName?: string; usernames?: Array<{ username: string }> }> }
      messages: { byChatId: Record<string, { byId: Record<string, { date: number }> }> }
    }
    const chats = global.chats?.byId ?? {}
    const users = global.users?.byId ?? {}
    const orderedIds = global.chats?.listIds?.active ?? Object.keys(chats)
    return orderedIds.slice(0, args.limit).map((id) => {
      const chat = chats[id]
      const user = users[id]
      const isSelf = id === global.currentUserId
      const userName = [user?.firstName, user?.lastName].filter(Boolean).join(' ')
      const title = isSelf ? 'Saved Messages'
        : chat?.title ?? (userName || user?.usernames?.[0]?.username || undefined)

      let lastMessageDate = chat?.lastMessage?.date
      if (!lastMessageDate) {
        const msgs = global.messages?.byChatId?.[id]?.byId
        if (msgs) {
          for (const m of Object.values(msgs)) {
            if (!lastMessageDate || m.date > lastMessageDate) lastMessageDate = m.date
          }
        }
      }

      return {
        id,
        title: title || undefined,
        type: chat?.type ?? 'unknown',
        ...(chat?.membersCount ? { membersCount: chat.membersCount } : {}),
        ...(chat?.unreadCount ? { unreadCount: chat.unreadCount } : {}),
        ...(lastMessageDate ? { lastMessageDate } : {}),
      }
    })
  }, { fnSrc: FIND_GET_GLOBAL_SRC, limit })
}

async function getMessages(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  if (!chatId) throw errors.missingParam('chatId')
  return page.evaluate((args: { fnSrc: string; chatId: string; limit: number; offsetId?: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      messages: { byChatId: Record<string, { byId: Record<string, {
        id: number; chatId: string; date: number; senderId?: string
        content?: { text?: { text?: string } }; isOutgoing?: boolean
      }> }> }
      users: { byId: Record<string, { id: string; firstName?: string; lastName?: string }> }
    }
    const chatMsgs = global.messages?.byChatId?.[args.chatId]?.byId
    if (!chatMsgs) return []
    let msgIds = Object.keys(chatMsgs).sort((a, b) => Number(b) - Number(a))
    if (args.offsetId) {
      const idx = msgIds.indexOf(String(args.offsetId))
      if (idx >= 0) msgIds = msgIds.slice(idx + 1)
    }
    const users = global.users?.byId ?? {}
    return msgIds.slice(0, args.limit).map((id) => {
      const msg = chatMsgs[id]
      const sender = msg.senderId ? users[msg.senderId] : undefined
      const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || undefined : undefined
      return {
        id: msg.id, chatId: msg.chatId, date: msg.date,
        text: msg.content?.text?.text ?? '',
        ...(msg.senderId ? { senderId: msg.senderId } : {}),
        ...(senderName ? { senderName } : {}),
        isOutgoing: msg.isOutgoing ?? false,
      }
    })
  }, { fnSrc: FIND_GET_GLOBAL_SRC, chatId, limit: Number(params.limit) || 50, offsetId: params.offsetId as number | undefined })
}

async function searchMessages(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const query = String(params.query ?? '')
  if (!query) throw errors.missingParam('query')
  return page.evaluate((args: { fnSrc: string; query: string; chatId?: string; limit: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      messages: { byChatId: Record<string, { byId: Record<string, {
        id: number; chatId: string; date: number; senderId?: string; content?: { text?: { text?: string } }
      }> }> }
      chats: { byId: Record<string, { title?: string }> }
      users: { byId: Record<string, { firstName?: string; lastName?: string; usernames?: Array<{ username: string }> }> }
    }
    const results: Array<{ id: number; chatId: string; chatTitle?: string; date: number; text: string; senderId?: string; senderName?: string }> = []
    const q = args.query.toLowerCase()
    const chatIds = args.chatId ? [args.chatId] : Object.keys(global.messages?.byChatId ?? {})
    for (const cid of chatIds) {
      const msgs = global.messages?.byChatId?.[cid]?.byId ?? {}
      for (const msg of Object.values(msgs)) {
        const text = msg.content?.text?.text ?? ''
        if (text.toLowerCase().includes(q)) {
          const chat = global.chats?.byId?.[cid]
          const sender = msg.senderId ? global.users?.byId?.[msg.senderId] : undefined
          const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || undefined : undefined
          results.push({
            id: msg.id, chatId: cid,
            ...(chat?.title ? { chatTitle: chat.title } : {}),
            date: msg.date, text,
            ...(msg.senderId ? { senderId: msg.senderId } : {}),
            ...(senderName ? { senderName } : {}),
          })
        }
      }
    }
    results.sort((a, b) => b.date - a.date)
    return results.slice(0, args.limit)
  }, { fnSrc: FIND_GET_GLOBAL_SRC, query, chatId: params.chatId as string | undefined, limit: Number(params.limit) || 20 })
}

async function getUserInfo(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const userId = String(params.userId)
  if (!userId) throw errors.missingParam('userId')
  return page.evaluate((args: { fnSrc: string; userId: string }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      users: { byId: Record<string, {
        id: string; firstName?: string; lastName?: string; phoneNumber?: string
        usernames?: Array<{ username: string }>; type?: string; status?: { type?: string }; isPremium?: boolean
      }> }
    }
    const user = global.users?.byId?.[args.userId]
    if (!user) return null
    return {
      id: user.id,
      ...(user.firstName ? { firstName: user.firstName } : {}),
      ...(user.lastName ? { lastName: user.lastName } : {}),
      ...(user.usernames?.[0]?.username ? { username: user.usernames[0].username } : {}),
      ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
      ...(user.type ? { type: user.type } : {}),
      ...(user.status?.type ? { status: user.status.type } : {}),
      ...(user.isPremium != null ? { isPremium: user.isPremium } : {}),
    }
  }, { fnSrc: FIND_GET_GLOBAL_SRC, userId })
}

async function getMe(page: Page) {
  return page.evaluate((fnSrc: string) => {
    const getGlobal = new Function(`return (${fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      currentUserId: string
      users: { byId: Record<string, {
        id: string; firstName?: string; lastName?: string; phoneNumber?: string
        usernames?: Array<{ username: string }>; isPremium?: boolean
      }> }
    }
    const userId = global.currentUserId
    const user = global.users?.byId?.[userId]
    return {
      id: userId,
      ...(user?.firstName ? { firstName: user.firstName } : {}),
      ...(user?.lastName ? { lastName: user.lastName } : {}),
      ...(user?.usernames?.[0]?.username ? { username: user.usernames[0].username } : {}),
      ...(user?.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
      ...(user?.isPremium != null ? { isPremium: user.isPremium } : {}),
    }
  }, FIND_GET_GLOBAL_SRC)
}

async function getContacts(page: Page) {
  return page.evaluate((fnSrc: string) => {
    const getGlobal = new Function(`return (${fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      contactList?: { userIds: string[] }
      users: { byId: Record<string, {
        id: string; firstName?: string; lastName?: string; phoneNumber?: string
        usernames?: Array<{ username: string }>; status?: { type?: string }
      }> }
    }
    const contactIds = global.contactList?.userIds ?? []
    const users = global.users?.byId ?? {}
    return contactIds.map(id => {
      const u = users[id]
      return {
        id,
        ...(u?.firstName ? { firstName: u.firstName } : {}),
        ...(u?.lastName ? { lastName: u.lastName } : {}),
        ...(u?.usernames?.[0]?.username ? { username: u.usernames[0].username } : {}),
        ...(u?.phoneNumber ? { phoneNumber: u.phoneNumber } : {}),
        ...(u?.status?.type ? { status: u.status.type } : {}),
      }
    }).filter(c => c.firstName || c.lastName)
  }, FIND_GET_GLOBAL_SRC)
}

// ── Write operations (callApi → GramJS Worker) ───────────────────

async function sendMessage(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  const text = String(params.text ?? '')
  if (!chatId) throw errors.missingParam('chatId')
  if (!text) throw errors.missingParam('text')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; text: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('sendMessage', { chat, text: args.text })
    return { success: true, chatId: peerId, text: args.text }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, text })
}

async function deleteMessage(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  const rawMessageId = params.messageId
  if (!chatId) throw errors.missingParam('chatId')
  if (rawMessageId == null) throw errors.missingParam('messageId')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, global, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    let messageId: number
    if (args.messageId === 'latest') {
      const chatMsgs = global.messages?.byChatId?.[peerId]?.byId ?? {}
      const outgoing = Object.values(chatMsgs).filter((m: { isOutgoing?: boolean }) => m.isOutgoing).sort((a: { id: number }, b: { id: number }) => b.id - a.id)
      if (!outgoing.length) throw new Error('No outgoing messages found')
      messageId = (outgoing[0] as { id: number }).id
    } else {
      messageId = Number(args.messageId)
      if (!messageId) throw new Error('messageId must be a number or "latest"')
    }
    await callApi('deleteMessages', { chat, messageIds: [messageId], shouldDeleteForAll: true })
    return { success: true, chatId: peerId, messageId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId: String(rawMessageId) })
}

async function editMessage(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  const rawMessageId = params.messageId
  const text = String(params.text ?? '')
  if (!chatId) throw errors.missingParam('chatId')
  if (rawMessageId == null) throw errors.missingParam('messageId')
  if (!text) throw errors.missingParam('text')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: string; text: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, global, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    let messageId: number
    if (args.messageId === 'latest') {
      const chatMsgs = global.messages?.byChatId?.[peerId]?.byId ?? {}
      const outgoing = Object.values(chatMsgs).filter((m: { isOutgoing?: boolean }) => m.isOutgoing).sort((a: { id: number }, b: { id: number }) => b.id - a.id)
      if (!outgoing.length) throw new Error('No outgoing messages found')
      messageId = (outgoing[0] as { id: number }).id
    } else {
      messageId = Number(args.messageId)
      if (!messageId) throw new Error('messageId must be a number or "latest"')
    }
    await callApi('editMessage', { chat, message: { chatId: peerId, id: messageId }, text: args.text })
    return { success: true, chatId: peerId, messageId, text: args.text }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId: String(rawMessageId), text })
}

async function forwardMessages(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const fromChatId = String(params.fromChatId)
  const toChatId = String(params.toChatId)
  const rawMessageIds = (params.messageIds as Array<number | string>) ?? []
  if (!fromChatId) throw errors.missingParam('fromChatId')
  if (!toChatId) throw errors.missingParam('toChatId')
  if (!rawMessageIds.length) throw errors.missingParam('messageIds')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; fromChatId: string; toChatId: string; rawMessageIds: Array<number | string> }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const from = resolveCtx(args.globalSrc, args.apiSrc, args.fromChatId)
    const toPeerIdRaw = args.toChatId === 'me' ? (from.global.currentUserId ?? '') : args.toChatId
    let toChat = from.global.chats?.byId?.[toPeerIdRaw]
    if (!toChat && toPeerIdRaw === from.global.currentUserId) {
      // Saved Messages — synthesize self-chat from users.byId (mirrors resolveCtx fallback)
      const u = from.global.users?.byId?.[toPeerIdRaw] as Record<string, unknown> | undefined
      if (u) toChat = { ...u, id: toPeerIdRaw, type: 'chatTypePrivate' }
    }
    if (!toChat) throw new Error(`Chat ${args.toChatId} not found in state`)
    const chatMsgs = from.global.messages?.byChatId?.[from.peerId]?.byId ?? {}
    const messageIds: number[] = args.rawMessageIds.map((raw) => {
      if (raw === 'latest') {
        const outgoing = Object.values(chatMsgs).filter((m: { isOutgoing?: boolean }) => m.isOutgoing).sort((a: { id: number }, b: { id: number }) => b.id - a.id)
        if (!outgoing.length) throw new Error('No outgoing messages found')
        return (outgoing[0] as { id: number }).id
      }
      const n = Number(raw)
      if (!n) throw new Error('messageIds must be numbers or "latest"')
      return n
    })
    const messages = messageIds.map(id => chatMsgs[id]).filter(Boolean)
    if (messages.length !== messageIds.length) throw new Error(`Some messages not loaded: ${messageIds.join(',')}`)
    try {
      await from.callApi('forwardMessages', { fromChat: from.chat, toChat, messages })
    } catch (e) {
      throw new Error(`forwardMessages callApi failed: ${(e as { message?: string })?.message ?? JSON.stringify(e)}`)
    }
    return { success: true, fromChatId: from.peerId, toChatId: toPeerIdRaw, messageIds }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, fromChatId, toChatId, rawMessageIds })
}

async function pinMessage(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  const rawMessageId = params.messageId
  if (!chatId) throw errors.missingParam('chatId')
  if (rawMessageId == null) throw errors.missingParam('messageId')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: string; silent: boolean }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, global, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    let messageId: number
    if (args.messageId === 'latest') {
      const chatMsgs = global.messages?.byChatId?.[peerId]?.byId ?? {}
      const outgoing = Object.values(chatMsgs).filter((m: { isOutgoing?: boolean }) => m.isOutgoing).sort((a: { id: number }, b: { id: number }) => b.id - a.id)
      if (!outgoing.length) throw new Error('No outgoing messages found')
      messageId = (outgoing[0] as { id: number }).id
    } else {
      messageId = Number(args.messageId)
      if (!messageId) throw new Error('messageId must be a number or "latest"')
    }
    await callApi('pinMessage', { chat, messageId, isUnpin: false, isOneSide: args.silent })
    return { success: true, chatId: peerId, messageId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId: String(rawMessageId), silent: !!params.silent })
}

async function unpinMessage(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  const rawMessageId = params.messageId
  if (!chatId) throw errors.missingParam('chatId')
  if (rawMessageId == null) throw errors.missingParam('messageId')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, global, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    let messageId: number
    if (args.messageId === 'latest') {
      // For unpin, prefer the currently pinned message if known
      const pinnedIds = (global.messages?.byChatId?.[peerId] as { pinnedIds?: number[] } | undefined)?.pinnedIds ?? []
      if (pinnedIds.length) {
        messageId = pinnedIds[pinnedIds.length - 1] as number
      } else {
        const chatMsgs = global.messages?.byChatId?.[peerId]?.byId ?? {}
        const outgoing = Object.values(chatMsgs).filter((m: { isOutgoing?: boolean }) => m.isOutgoing).sort((a: { id: number }, b: { id: number }) => b.id - a.id)
        if (!outgoing.length) throw new Error('No outgoing messages found')
        messageId = (outgoing[0] as { id: number }).id
      }
    } else {
      messageId = Number(args.messageId)
      if (!messageId) throw new Error('messageId must be a number or "latest"')
    }
    await callApi('pinMessage', { chat, messageId, isUnpin: true })
    return { success: true, chatId: peerId, messageId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId: String(rawMessageId) })
}

async function markAsRead(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) {
  const chatId = String(params.chatId)
  if (!chatId) throw errors.missingParam('chatId')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('markMessageListRead', { chat, threadId: 0 })
    return { success: true, chatId: peerId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId })
}

// ── Runner export ────────────────────────────────────────────────

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  getChats: (page, params) => getChats(page, params),
  getMessages: (page, params, h) => getMessages(page, params, h.errors),
  searchMessages: (page, params, h) => searchMessages(page, params, h.errors),
  getUserInfo: (page, params, h) => getUserInfo(page, params, h.errors),
  getMe: (page) => getMe(page),
  getContacts: (page) => getContacts(page),
  sendMessage: (page, params, h) => sendMessage(page, params, h.errors),
  deleteMessage: (page, params, h) => deleteMessage(page, params, h.errors),
  editMessage: (page, params, h) => editMessage(page, params, h.errors),
  forwardMessages: (page, params, h) => forwardMessages(page, params, h.errors),
  pinMessage: (page, params, h) => pinMessage(page, params, h.errors),
  unpinMessage: (page, params, h) => unpinMessage(page, params, h.errors),
  markAsRead: (page, params, h) => markAsRead(page, params, h.errors),
}

/**
 * Wait until Telegram's webpack state is populated:
 *   1. webpack chunk array exists
 *   2. getGlobal() resolves (a module exposes a chats/users-shaped state)
 *   3. currentUserId is set (i.e. session is authenticated)
 *   4. chats.byId has at least one entry (chat list hydrated)
 *
 * Telegram Web hydrates its teact global asynchronously after the SPA boots
 * (especially on first navigation in a fresh tab). The pre-shim adapter's
 * runtime-level init+retry handled this; with CustomRunner we wait inline.
 */
async function waitForState(page: Page, timeoutMs: number): Promise<'ready' | 'unauthenticated' | 'no_chats' | 'no_global'> {
  const deadline = Date.now() + timeoutMs
  let last: 'ready' | 'unauthenticated' | 'no_chats' | 'no_global' = 'no_global'
  while (Date.now() < deadline) {
    last = await page.evaluate((fnSrc: string) => {
      const findFn = new Function(`return (${fnSrc})()`) as () => (() => Record<string, unknown>) | null
      const getGlobal = findFn()
      if (!getGlobal) return 'no_global' as const
      const g = getGlobal() as { currentUserId?: string; chats?: { byId?: Record<string, unknown> } }
      if (!g?.currentUserId) return 'unauthenticated' as const
      const chatCount = Object.keys(g.chats?.byId ?? {}).length
      if (chatCount === 0) return 'no_chats' as const
      return 'ready' as const
    }, FIND_GET_GLOBAL_SRC)
    if (last === 'ready') return last
    await page.waitForTimeout(500)
  }
  return last
}

const runner: CustomRunner = {
  name: 'telegram-protocol',
  description: 'Telegram Web — reads via webpack state, writes via GramJS callApi',
  warmTimeoutMs: 30_000,

  /**
   * SPA-readiness gate (was init() pre-32a698a; load-bearing for IndexedDB hydration).
   * page.goto fires `load` before Telegram's webpack bundle parses + IndexedDB
   * session boots. Without this, run() races the SPA and sees QR-login fallback.
   * Polled by warm-session (15 s default, overridden to 30 s above).
   */
  async warmReady(page: Page): Promise<boolean> {
    if (!page.url().includes('web.telegram.org')) return true
    return page
      .evaluate((fnSrc: string) => {
        const w = window as Record<string, unknown>
        const hasChunks = Array.isArray(w.webpackChunktelegram_t) || Array.isArray(w.webpackChunkwebk)
        if (!hasChunks) return false
        try {
          const findFn = new Function(`return (${fnSrc})()`) as () => (() => Record<string, unknown>) | null
          const getGlobal = findFn()
          if (!getGlobal) return false
          const state = getGlobal() as { currentUserId?: string } | null
          return !!state && state.currentUserId != null
        } catch {
          return false
        }
      }, FIND_GET_GLOBAL_SRC)
      .catch(() => false)
  },

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('telegram-protocol requires a page (transport: page)')

    // "Many logins" conflict check — Telegram shows this when the same
    // session is open in multiple tabs; webpack state is unavailable.
    const conflict = await page.evaluate(() => document.body?.innerText?.includes('Many logins') ?? false)
    if (conflict) throw helpers.errors.fatal('Telegram "Many logins" conflict — close other tabs')

    // Wait for teact state hydration. Reload + retry once if state never
    // populates within the first window — matches the legacy runtime's
    // init-retry semantics that were lost during the CustomRunner migration.
    let state = await waitForState(page, 12000)
    if (state !== 'ready') {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForTimeout(2000)
      state = await waitForState(page, 12000)
    }
    if (state === 'no_global') throw helpers.errors.retriable('Telegram webpack state not found — page not ready')
    if (state === 'unauthenticated') throw helpers.errors.fatal('Telegram session not authenticated — log in via web.telegram.org/a/')
    // 'no_chats' is acceptable for ops that don't require chats.byId (e.g. getMe)
    // — handlers will surface a clear error if they need a chat that isn't loaded.

    // Note: previously tried to lazy-load missing chats by setting
    // window.location.hash = '#<chatId>'. Per commit cd0a9ea, "TG Web A
    // ignores post-boot hash changes", so that approach silently no-ops.
    // Instead, when the requested chat isn't in chats.byId, dispatch
    // actions.openChat({ id }) — TG's own action handler loads the dialog
    // into BOTH the teact global AND the GramJS Worker entity cache (which
    // is what callApi needs to build InputPeer).
    await ensureChatsLoaded(page, params)

    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner

/**
 * For each chatId in params, if chats.byId[id] is missing, dispatch
 * actions.openChat({ id }) to make TG load the dialog (teact global +
 * Worker entity cache). Waits up to 5s per chat for hydration; never
 * throws — handlers will surface a clear error downstream if missing.
 */
async function ensureChatsLoaded(page: Page, params: Readonly<Record<string, unknown>>): Promise<void> {
  const raw: string[] = []
  for (const k of ['chatId', 'fromChatId', 'toChatId']) {
    const v = params[k]
    if (typeof v === 'string' && v && !v.startsWith('+')) raw.push(v)
  }
  if (!raw.length) return

  await page.evaluate(async (args: { globalSrc: string; actionsSrc: string; chatIds: string[] }) => {
    const getGlobal = new Function(`return (${args.globalSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) return
    const getActions = new Function(`return (${args.actionsSrc})()`)() as (() => Record<string, (a?: unknown) => unknown>) | null
    if (!getActions) return
    const actions = getActions()
    const g = getGlobal() as { currentUserId?: string; chats?: { byId?: Record<string, unknown> } }

    for (const cid of args.chatIds) {
      const id = cid === 'me' ? g.currentUserId : cid
      if (!id) continue
      if (g.chats?.byId?.[id]) continue
      try { actions.openChat({ id, shouldReplaceHistory: false }) } catch { /* dispatcher may throw */ }
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const fresh = getGlobal() as { chats?: { byId?: Record<string, unknown> } }
        if (fresh.chats?.byId?.[id]) break
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, actionsSrc: FIND_GET_ACTIONS_SRC, chatIds: raw })
}

