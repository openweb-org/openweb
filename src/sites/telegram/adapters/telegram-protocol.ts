/**
 * Telegram Web L3 adapter.
 *
 * Reads via getGlobal() (webpack state), writes via callApi() (GramJS Worker).
 * Zero DOM manipulation — all ops go through the webpack module cache.
 *
 * Supports Web A (/a/ — teact, webpackChunktelegram_t) and
 * Web K (/k/ — webpackChunkwebk). Module IDs are mangled per deploy;
 * the adapter finds getGlobal/callApi dynamically by testing return shapes
 * and scanning module source for known string constants.
 */

// Inline CodeAdapter interface — avoid external imports so adapter works from compile cache
interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: import('patchright').Page): Promise<boolean>
  isAuthenticated(page: import('patchright').Page): Promise<boolean>
  execute(
    page: import('patchright').Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
}

type Page = import('patchright').Page

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

function makeError(message: string, failureClass: string, retriable = false): Error {
  return Object.assign(new Error(message), { failureClass, retriable })
}

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

  const chat = global.chats?.byId?.[peerId]
  if (!chat) throw new Error(`Chat ${peerId} not found in state`)

  return { getGlobal, callApi, global, chat, peerId }
}

const RESOLVE_CTX_SRC = resolveCtx.toString()

// ── Read operations (getGlobal) ───────────────────────────────────

async function getChats(page: Page, params: Readonly<Record<string, unknown>>) {
  const limit = Number(params.limit) || 50
  return page.evaluate((args: { fnSrc: string; limit: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      chats: { byId: Record<string, { id: string; title?: string; type: string; membersCount?: number; lastMessage?: { date?: number } }>
        listIds?: { active?: string[] } }
      users: { byId: Record<string, { id: string; firstName?: string; lastName?: string; usernames?: Array<{ username: string }> }> }
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
        membersCount: chat?.membersCount,
        lastMessageDate: chat?.lastMessage?.date,
      }
    })
  }, { fnSrc: FIND_GET_GLOBAL_SRC, limit })
}

async function getMessages(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  if (!chatId) throw makeError('chatId is required', 'fatal')
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
      return {
        id: msg.id, chatId: msg.chatId, date: msg.date,
        text: msg.content?.text?.text ?? '',
        senderId: msg.senderId,
        senderName: sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') : undefined,
        isOutgoing: msg.isOutgoing ?? false,
      }
    })
  }, { fnSrc: FIND_GET_GLOBAL_SRC, chatId, limit: Number(params.limit) || 50, offsetId: params.offsetId as number | undefined })
}

async function searchMessages(page: Page, params: Readonly<Record<string, unknown>>) {
  const query = String(params.query ?? '')
  if (!query) throw makeError('query is required', 'fatal')
  return page.evaluate((args: { fnSrc: string; query: string; chatId?: string; limit: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      messages: { byChatId: Record<string, { byId: Record<string, {
        id: number; chatId: string; date: number; senderId?: string; content?: { text?: { text?: string } }
      }> }> }
      chats: { byId: Record<string, { title?: string }> }
      users: { byId: Record<string, { firstName?: string; lastName?: string }> }
    }
    const results: Array<{ id: number; chatId: string; chatTitle: string; date: number; text: string; senderId?: string; senderName?: string }> = []
    const q = args.query.toLowerCase()
    const chatIds = args.chatId ? [args.chatId] : Object.keys(global.messages?.byChatId ?? {})
    for (const cid of chatIds) {
      const msgs = global.messages?.byChatId?.[cid]?.byId ?? {}
      for (const msg of Object.values(msgs)) {
        const text = msg.content?.text?.text ?? ''
        if (text.toLowerCase().includes(q)) {
          const chat = global.chats?.byId?.[cid]
          const sender = msg.senderId ? global.users?.byId?.[msg.senderId] : undefined
          results.push({
            id: msg.id, chatId: cid, chatTitle: chat?.title ?? 'unknown',
            date: msg.date, text, senderId: msg.senderId,
            senderName: sender ? [sender.firstName, sender.lastName].filter(Boolean).join(' ') : undefined,
          })
        }
      }
    }
    results.sort((a, b) => b.date - a.date)
    return results.slice(0, args.limit)
  }, { fnSrc: FIND_GET_GLOBAL_SRC, query, chatId: params.chatId as string | undefined, limit: Number(params.limit) || 20 })
}

async function getUserInfo(page: Page, params: Readonly<Record<string, unknown>>) {
  const userId = String(params.userId)
  if (!userId) throw makeError('userId is required', 'fatal')
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
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      username: user.usernames?.[0]?.username, phoneNumber: user.phoneNumber,
      type: user.type, status: user.status?.type, isPremium: user.isPremium,
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
      id: userId, firstName: user?.firstName, lastName: user?.lastName,
      username: user?.usernames?.[0]?.username, phoneNumber: user?.phoneNumber,
      isPremium: user?.isPremium,
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
        id, firstName: u?.firstName, lastName: u?.lastName,
        username: u?.usernames?.[0]?.username, phoneNumber: u?.phoneNumber,
        status: u?.status?.type,
      }
    }).filter(c => c.firstName || c.lastName)
  }, FIND_GET_GLOBAL_SRC)
}

// ── Write operations (callApi → GramJS Worker) ───────────────────

async function sendMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const text = String(params.text ?? '')
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (!text) throw makeError('text is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; text: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('sendMessage', { chat, text: args.text })
    return { success: true, chatId: peerId, text: args.text }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, text })
}

async function deleteMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const rawMessageId = params.messageId
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (rawMessageId == null) throw makeError('messageId is required', 'fatal')
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

async function editMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const messageId = Number(params.messageId)
  const text = String(params.text ?? '')
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (!messageId) throw makeError('messageId is required', 'fatal')
  if (!text) throw makeError('text is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: number; text: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('editMessage', { chat, message: { chatId: peerId, id: args.messageId }, text: args.text })
    return { success: true, chatId: peerId, messageId: args.messageId, text: args.text }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId, text })
}

async function forwardMessages(page: Page, params: Readonly<Record<string, unknown>>) {
  const fromChatId = String(params.fromChatId)
  const toChatId = String(params.toChatId)
  const messageIds = (params.messageIds as number[]) ?? []
  if (!fromChatId) throw makeError('fromChatId is required', 'fatal')
  if (!toChatId) throw makeError('toChatId is required', 'fatal')
  if (!messageIds.length) throw makeError('messageIds is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; fromChatId: string; toChatId: string; messageIds: number[] }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const from = resolveCtx(args.globalSrc, args.apiSrc, args.fromChatId)
    const to = resolveCtx(args.globalSrc, args.apiSrc, args.toChatId)
    await from.callApi('forwardMessages', { fromChat: from.chat, toChat: to.chat, messages: args.messageIds.map(id => ({ id, chatId: from.peerId })) })
    return { success: true, fromChatId: from.peerId, toChatId: to.peerId, messageIds: args.messageIds }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, fromChatId, toChatId, messageIds })
}

async function pinMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const messageId = Number(params.messageId)
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (!messageId) throw makeError('messageId is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: number; silent: boolean }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('pinMessage', { chat, messageId: args.messageId, isUnpin: false, isOneSide: args.silent })
    return { success: true, chatId: peerId, messageId: args.messageId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId, silent: !!params.silent })
}

async function unpinMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const messageId = Number(params.messageId)
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (!messageId) throw makeError('messageId is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string; messageId: number }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('pinMessage', { chat, messageId: args.messageId, isUnpin: true })
    return { success: true, chatId: peerId, messageId: args.messageId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId, messageId })
}

async function markAsRead(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  if (!chatId) throw makeError('chatId is required', 'fatal')
  return page.evaluate(async (args: { globalSrc: string; apiSrc: string; ctxSrc: string; chatId: string }) => {
    const resolveCtx = new Function(`return (${args.ctxSrc})`)() as typeof import('./telegram-protocol').resolveCtx
    const { callApi, chat, peerId } = resolveCtx(args.globalSrc, args.apiSrc, args.chatId)
    await callApi('markMessageListRead', { chat, threadId: 0 })
    return { success: true, chatId: peerId }
  }, { globalSrc: FIND_GET_GLOBAL_SRC, apiSrc: FIND_CALL_API_SRC, ctxSrc: RESOLVE_CTX_SRC, chatId })
}

// ── Adapter export ────────────────────────────────────────────────

const adapter: CodeAdapter = {
  name: 'telegram-protocol',
  description: 'Telegram Web — reads via webpack state, writes via GramJS callApi',

  async init(page: Page): Promise<boolean> {
    if (!page.url().includes('web.telegram.org')) return false
    const conflict = await page.evaluate(() => document.body?.innerText?.includes('Many logins') ?? false)
    if (conflict) return false
    const ready = await page.evaluate(() => {
      const w = window as Record<string, unknown>
      return Array.isArray(w.webpackChunktelegram_t) || Array.isArray(w.webpackChunkwebk)
    })
    if (!ready) return false
    try {
      return await page.evaluate((fnSrc: string) => {
        try { return new Function(`return (${fnSrc})()`)() !== null } catch { return false }
      }, FIND_GET_GLOBAL_SRC)
    } catch { return false }
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const state = await page.evaluate((fnSrc: string) => {
      const findFn = new Function(`return (${fnSrc})()`) as () => (() => Record<string, unknown>) | null
      const getGlobal = findFn()
      if (!getGlobal) return 'missing'
      return getGlobal()?.currentUserId ? 'authenticated' : 'unauthenticated'
    }, FIND_GET_GLOBAL_SRC)
    if (state === 'missing') throw makeError('getGlobal not found', 'needs_page')
    return state === 'authenticated'
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      switch (operation) {
        case 'getChats': return await getChats(page, params)
        case 'getMessages': return await getMessages(page, params)
        case 'searchMessages': return await searchMessages(page, params)
        case 'getUserInfo': return await getUserInfo(page, params)
        case 'getMe': return await getMe(page)
        case 'getContacts': return await getContacts(page)
        case 'sendMessage': return await sendMessage(page, params)
        case 'deleteMessage': return await deleteMessage(page, params)
        case 'editMessage': return await editMessage(page, params)
        case 'forwardMessages': return await forwardMessages(page, params)
        case 'pinMessage': return await pinMessage(page, params)
        case 'unpinMessage': return await unpinMessage(page, params)
        case 'markAsRead': return await markAsRead(page, params)
        default: throw makeError(`Unknown operation: ${operation}`, 'fatal')
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'failureClass' in error) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('getGlobal not found')) throw makeError(message, 'needs_page')
      throw makeError(message, 'retriable', true)
    }
  },
}

export default adapter
