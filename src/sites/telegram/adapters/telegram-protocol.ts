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
          if (r?.chats && r.users && r.currentUserId) {
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

// --- Operation handlers ---

async function getChats(page: Page, params: Readonly<Record<string, unknown>>) {
  return page.evaluate((args: { fnSrc: string; limit: number; folderId?: number }) => {
    const getGlobal = new Function(`return (${args.fnSrc})()`)() as (() => Record<string, unknown>) | null
    if (!getGlobal) throw new Error('getGlobal not found')
    const global = getGlobal() as {
      chats: { byId: Record<string, { id: string; title?: string; type: string; membersCount?: number; lastMessage?: { date?: number } }>;
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
  }, { fnSrc: FIND_GET_GLOBAL_SRC, limit: Number(params.limit) || 50, folderId: params.folderId as number | undefined })
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
  // Use Telegram's internal message input rather than direct state mutation
  // Navigate to the chat, type message, and submit
  return page.evaluate(async (args: { chatId: string; text: string }) => {
    // Find the compose area and type into it
    // Telegram Web A uses a contenteditable div for message input
    const input = document.querySelector<HTMLDivElement>('#editable-message-text')
    if (!input) throw new Error('Message input not found — navigate to a chat first')

    // Focus and clear
    input.focus()
    input.textContent = ''

    // Insert text via execCommand to trigger SPA reactivity
    document.execCommand('insertText', false, args.text)

    // Wait for send button to become active
    await new Promise(r => setTimeout(r, 300))

    // Click send button
    const sendBtn = document.querySelector<HTMLButtonElement>('button.send, button[aria-label="Send"], .send-button')
    if (!sendBtn) throw new Error('Send button not found')
    sendBtn.click()

    await new Promise(r => setTimeout(r, 500))
    return { success: true, chatId: args.chatId, text: args.text }
  }, { chatId, text })
}

// --- Adapter export ---

const adapter: CodeAdapter = {
  name: 'telegram-protocol',
  description: 'Telegram Web A global state access via teact/webpack',

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      return Array.isArray((window as Record<string, unknown>).webpackChunktelegram_t)
    })
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
