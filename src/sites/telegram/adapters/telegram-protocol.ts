/**
 * Telegram Web L3 adapter.
 *
 * Supports both Web A (/a/ — teact, webpackChunktelegram_t) and
 * Web K (/k/ — webpackChunkwebk). Reads global state via webpack
 * module cache. Never navigates or reloads — uses whatever page
 * the executor provides.
 *
 * Key pitfall: module IDs and export names are mangled per deploy.
 * The adapter finds getGlobal dynamically by testing return shapes.
 */

// Inline CodeAdapter interface — avoid external imports so adapter works from compile cache
interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: import('playwright-core').Page): Promise<boolean>
  isAuthenticated(page: import('playwright-core').Page): Promise<boolean>
  execute(
    page: import('playwright-core').Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
}

type Page = import('playwright-core').Page

/**
 * Find teact/webk getGlobal by walking webpack modules.
 * Supports both Web A (webpackChunktelegram_t) and Web K (webpackChunkwebk).
 * Does NOT require currentUserId — works pre-auth so isAuthenticated() can run.
 */
function findGetGlobal(): (() => Record<string, unknown>) | null {
  const w = window as Record<string, unknown>
  // Try Web A first, then Web K
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
        } catch { /* module function call may throw */ }
      }
    } catch { /* module require may throw */ }
  }
  return null
}

const FIND_GET_GLOBAL_SRC = findGetGlobal.toString()

function makeError(message: string, failureClass: string, retriable = false): Error {
  const err = new Error(message)
  ;(err as any).failureClass = failureClass
  ;(err as any).retriable = retriable
  return err
}

// --- helpers ---

/** Run findGetGlobal in page context and throw if missing */
function evalGetGlobal(page: Page) {
  return page.evaluate((fnSrc: string) => {
    const getGlobal = new Function(`return (${fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    return getGlobal()
  }, FIND_GET_GLOBAL_SRC)
}

// --- Operation handlers ---

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
      const msg = chatMsgs[id] as Record<string, any>
      const sender = msg.senderId ? users[msg.senderId] : undefined
      return {
        id: msg.id,
        chatId: msg.chatId,
        date: msg.date,
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
        id: number; chatId: string; date: number; senderId?: string
        content?: { text?: { text?: string } }
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
        const text = (msg as any).content?.text?.text ?? ''
        if (text.toLowerCase().includes(q)) {
          const chat = global.chats?.byId?.[cid]
          const sender = (msg as any).senderId ? global.users?.byId?.[(msg as any).senderId] : undefined
          results.push({
            id: (msg as any).id,
            chatId: cid,
            chatTitle: chat?.title ?? 'unknown',
            date: (msg as any).date,
            text,
            senderId: (msg as any).senderId,
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
        usernames?: Array<{ username: string }>; type?: string; status?: { type?: string }
        accessHash?: string; isPremium?: boolean
      }> }
    }
    const user = global.users?.byId?.[args.userId]
    if (!user) return null
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.usernames?.[0]?.username,
      phoneNumber: user.phoneNumber,
      type: user.type,
      status: user.status?.type,
      isPremium: user.isPremium,
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
      firstName: user?.firstName,
      lastName: user?.lastName,
      username: user?.usernames?.[0]?.username,
      phoneNumber: user?.phoneNumber,
      isPremium: user?.isPremium,
    }
  }, FIND_GET_GLOBAL_SRC)
}

async function sendMessage(page: Page, params: Readonly<Record<string, unknown>>) {
  const chatId = String(params.chatId)
  const text = String(params.text ?? '')
  if (!chatId) throw makeError('chatId is required', 'fatal')
  if (!text) throw makeError('text is required', 'fatal')
  return page.evaluate(async (args: { chatId: string; text: string }) => {
    // Web A: #editable-message-text, Web K: .input-message-input
    const input = document.querySelector<HTMLDivElement>('#editable-message-text, .input-message-input')
    if (!input) throw new Error('Message input not found — navigate to a chat first')
    input.focus()
    input.textContent = ''
    document.execCommand('insertText', false, args.text)
    await new Promise(r => setTimeout(r, 300))
    const sendBtn = document.querySelector<HTMLButtonElement>('button.send, button[aria-label="Send"], .send-button, .btn-send')
    if (!sendBtn) throw new Error('Send button not found')
    sendBtn.click()
    await new Promise(r => setTimeout(r, 500))
    return { success: true, chatId: args.chatId, text: args.text }
  }, { chatId, text })
}

// --- Adapter export ---

const adapter: CodeAdapter = {
  name: 'telegram-protocol',
  description: 'Telegram Web global state access via webpack (supports /a/ and /k/)',

  async init(page: Page): Promise<boolean> {
    // Never navigate — just check if the current page has Telegram state
    if (!page.url().includes('web.telegram.org')) return false

    // Quick check — state is usually available immediately on a loaded page
    const ready = await page.evaluate(() => {
      const w = window as Record<string, unknown>
      return Array.isArray(w.webpackChunktelegram_t) || Array.isArray(w.webpackChunkwebk)
    })
    if (!ready) return false

    // Verify getGlobal is accessible (state has bootstrapped)
    try {
      const found = await page.evaluate((fnSrc: string) => {
        try {
          return new Function(`return (${fnSrc})()`)() !== null
        } catch { return false }
      }, FIND_GET_GLOBAL_SRC)
      return found
    } catch {
      return false
    }
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const state = await page.evaluate((fnSrc: string) => {
      const findFn = new Function(`return (${fnSrc})()`) as () => (() => Record<string, unknown>) | null
      const getGlobal = findFn()
      if (!getGlobal) return 'missing'
      return getGlobal()?.currentUserId ? 'authenticated' : 'unauthenticated'
    }, FIND_GET_GLOBAL_SRC)

    if (state === 'missing') {
      throw makeError('getGlobal not found — Telegram state unavailable', 'needs_page')
    }
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
        case 'sendMessage': return await sendMessage(page, params)
        default: throw makeError(`Unknown operation: ${operation}`, 'fatal')
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'failureClass' in error) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('getGlobal not found')) {
        throw makeError(message, 'needs_page')
      }
      throw makeError(message, 'retriable', true)
    }
  },
}

export default adapter
