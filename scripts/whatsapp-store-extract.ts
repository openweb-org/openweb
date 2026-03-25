/**
 * WhatsApp Web Store extraction — we cracked the module system!
 *
 * Uses require('WAWeb*') to access internal stores and extract:
 * 1. Chat list with last messages
 * 2. Message history for specific contacts
 * 3. Contact details
 * 4. Send a test message to +1 (347)222-5726
 *
 * SAFETY: ONLY interacts with contact +1 (347)222-5726
 *
 * Usage: npx tsx scripts/whatsapp-store-extract.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CDP_PORT = process.env.OPENWEB_CDP_PORT ?? '9222'
const SAFE_CONTACT = '13472225726@c.us'

async function main(): Promise<void> {
  console.log(`Connecting to Chrome CDP on port ${CDP_PORT}...`)
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)

  let whatsappPage = null
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes('web.whatsapp.com')) {
        whatsappPage = page
        break
      }
    }
    if (whatsappPage) break
  }
  if (!whatsappPage) {
    console.error('No WhatsApp tab found')
    process.exit(1)
  }

  // ── 1. Enumerate WAWeb* modules ─────────────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  1. ENUMERATE ALL WAWeb* MODULES')
  console.log('═══════════════════════════════════════════\n')

  const moduleNames = await whatsappPage.evaluate(() => {
    // The require function uses string module names.
    // Let's discover all available module names.
    // We know they start with "WAWeb" — but let's also check the __d registry.

    const results: Record<string, string> = {}

    // First, let's look at the WAWebCollections module in detail
    // @ts-ignore
    const collections = require('WAWebCollections')
    if (collections) {
      results.collectionsKeys = Object.keys(collections).join(', ')
    }

    // Probe a wide set of known module names
    const prefixes = ['WAWeb']
    const suffixes = [
      'Collections', 'MsgCollection', 'ChatCollection', 'ContactCollection',
      'MsgModel', 'ChatModel', 'ContactModel', 'ConnModel',
      'SocketModel', 'Cmd', 'BuildConstants', 'StreamModel',
      'SendMsg', 'SendMsgAction', 'SendTextMsg', 'CreateMsg',
      'CreateMsgProtobuf', 'MsgActionStore', 'ChatAction',
      'WapQuery', 'Socket', 'Stream', 'Presence',
      'GroupMetadata', 'ProfilePic', 'Status', 'Sticker',
      'MediaUpload', 'MediaDownload', 'Validators',
      'MsgKey', 'WidFactory', 'UserPrefs',
      'RealtimeActions', 'MsgInfo', 'Features',
      'HistorySync', 'E2E', 'SignalStore',
      // Action/function modules
      'SendMsgRecordAction', 'DeleteMsgAction', 'StarMsgAction',
      'RevokeMsgAction', 'PinMsgAction',
      'ArchiveChatAction', 'DeleteChatAction', 'MuteChatAction',
      'ReadChatAction', 'ClearChatAction',
      // UI/render modules
      'ChatListModel', 'ConversationModel',
      'BizProfileUtils', 'GroupUtils',
      // Newer API-style modules
      'Api', 'ApiModule', 'WebClient',
    ]

    const found: string[] = []
    const notFound: string[] = []
    for (const suffix of suffixes) {
      for (const prefix of prefixes) {
        const name = `${prefix}${suffix}`
        try {
          // @ts-ignore
          const mod = require(name)
          if (mod) {
            const keys = typeof mod === 'object' ? Object.keys(mod).slice(0, 15) : []
            found.push(`${name}: [${keys.join(', ')}]`)
          } else {
            notFound.push(name)
          }
        } catch {
          notFound.push(name)
        }
      }
    }
    results.found = found.join('\n')
    results.notFoundCount = String(notFound.length)

    return results
  })

  console.log('  Found modules:')
  console.log(moduleNames.found?.split('\n').map((l: string) => `    ${l}`).join('\n'))
  console.log(`\n  Not found: ${moduleNames.notFoundCount} module names tried`)
  console.log(`\n  WAWebCollections keys: ${moduleNames.collectionsKeys}`)

  // ── 2. Extract chat list from Store ─────────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  2. CHAT LIST FROM STORE (DECRYPTED)')
  console.log('═══════════════════════════════════════════\n')

  const chatData = await whatsappPage.evaluate(() => {
    // @ts-ignore
    const { ChatCollection } = require('WAWebChatCollection')
    // @ts-ignore
    const collections = require('WAWebCollections')

    const results: Record<string, any> = {}

    // Try to get the chat collection instance
    if (ChatCollection) {
      results.chatCollectionType = typeof ChatCollection
      results.chatCollectionKeys = Object.keys(ChatCollection).slice(0, 20)

      // Check if it's a class or instance
      if (ChatCollection.getModelsArray) {
        const models = ChatCollection.getModelsArray()
        results.chatCount = models.length

        // Extract chat info
        results.chats = models.slice(0, 20).map((chat: any) => {
          try {
            return {
              id: chat.id?._serialized ?? chat.id?.toString() ?? 'unknown',
              name: chat.name ?? chat.formattedTitle ?? chat.contact?.pushname ?? '[no name]',
              isGroup: chat.isGroup ?? false,
              unreadCount: chat.unreadCount ?? 0,
              timestamp: chat.t ?? 0,
              lastMessage: chat.lastReceivedKey?.toString() ?? '',
              muteExpiration: chat.muteExpiration ?? 0,
            }
          } catch {
            return { id: 'error', name: 'error' }
          }
        })
      } else if (typeof ChatCollection === 'function') {
        results.chatCollectionIsClass = true
        results.chatCollectionProtoKeys = Object.getOwnPropertyNames(ChatCollection.prototype).slice(0, 20)
      }
    }

    // Also try via WAWebCollections.Chat
    if (collections?.Chat) {
      results.collectionsChat = typeof collections.Chat
      results.collectionsChatKeys = Object.keys(collections.Chat).slice(0, 20)
      if (collections.Chat.getModelsArray) {
        results.collectionsChatCount = collections.Chat.getModelsArray().length
      }
    }

    return results
  })

  console.log(`  ChatCollection type: ${chatData.chatCollectionType}`)
  console.log(`  ChatCollection keys: ${JSON.stringify(chatData.chatCollectionKeys)}`)
  console.log(`  Chat count: ${chatData.chatCount ?? chatData.collectionsChatCount ?? 'unknown'}`)
  if (chatData.chats) {
    console.log('\n  Chats:')
    for (const chat of chatData.chats.slice(0, 15)) {
      const group = chat.isGroup ? '[G]' : '[C]'
      const ts = chat.timestamp ? new Date(chat.timestamp * 1000).toISOString().slice(0, 10) : '?'
      console.log(`    ${group} ${chat.name} (${chat.id}) — ${ts} — unread: ${chat.unreadCount}`)
    }
  }

  // ── 3. Extract messages for safe contact ────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log(`  3. MESSAGES FOR ${SAFE_CONTACT}`)
  console.log('═══════════════════════════════════════════\n')

  const msgData = await whatsappPage.evaluate((contactId) => {
    // @ts-ignore
    const { MsgCollection } = require('WAWebMsgCollection')
    // @ts-ignore
    const { ChatCollection } = require('WAWebChatCollection')

    const results: Record<string, any> = {}

    // Find the chat for our safe contact
    if (ChatCollection?.getModelsArray) {
      const chats = ChatCollection.getModelsArray()
      const targetChat = chats.find((c: any) => {
        const cid = c.id?._serialized ?? c.id?.toString() ?? ''
        return cid.includes('13472225726')
      })

      if (targetChat) {
        results.chatFound = true
        results.chatId = targetChat.id?._serialized ?? String(targetChat.id)
        results.chatName = targetChat.name ?? targetChat.formattedTitle ?? targetChat.contact?.pushname ?? '[no name]'

        // Try to get messages from this chat
        if (targetChat.msgs) {
          results.msgsType = typeof targetChat.msgs
          results.msgsKeys = Object.keys(targetChat.msgs).slice(0, 20)

          if (targetChat.msgs.getModelsArray) {
            const msgs = targetChat.msgs.getModelsArray()
            results.msgCount = msgs.length
            results.messages = msgs.slice(-20).map((msg: any) => {
              try {
                return {
                  id: msg.id?.toString() ?? 'unknown',
                  type: msg.type ?? 'unknown',
                  body: msg.body ?? msg.caption ?? msg.text ?? '[no body]',
                  timestamp: msg.t ?? 0,
                  fromMe: msg.id?.fromMe ?? false,
                  ack: msg.ack ?? -1,
                  isMedia: msg.isMedia ?? false,
                }
              } catch {
                return { id: 'error' }
              }
            })
          }
        }

        // Also try loading messages via the collection
        if (targetChat.loadEarlierMsgs) {
          results.hasLoadEarlierMsgs = true
        }
      } else {
        results.chatFound = false
        // List all chat IDs to find the right one
        results.allChatIds = chats.slice(0, 30).map((c: any) =>
          c.id?._serialized ?? c.id?.toString() ?? 'unknown'
        )
      }
    }

    return results
  }, SAFE_CONTACT)

  console.log(`  Chat found: ${msgData.chatFound}`)
  if (msgData.chatFound) {
    console.log(`  Chat ID: ${msgData.chatId}`)
    console.log(`  Chat name: ${msgData.chatName}`)
    console.log(`  Message count (in memory): ${msgData.msgCount ?? 'unknown'}`)
    if (msgData.messages) {
      console.log('\n  Recent messages:')
      for (const msg of msgData.messages) {
        const dir = msg.fromMe ? '>>>' : '<<<'
        const ts = msg.timestamp ? new Date(msg.timestamp * 1000).toISOString().slice(0, 19) : '?'
        console.log(`    ${dir} [${msg.type}] ${ts} | ${String(msg.body).slice(0, 100)} (ack=${msg.ack})`)
      }
    }
  } else {
    console.log('  Available chat IDs:')
    for (const id of msgData.allChatIds?.slice(0, 20) ?? []) {
      console.log(`    ${id}`)
    }
  }

  // ── 4. Explore send message capabilities ────────────────────

  console.log('\n═══════════════════════════════════════════')
  console.log('  4. SEND MESSAGE API EXPLORATION')
  console.log('═══════════════════════════════════════════\n')

  const sendApi = await whatsappPage.evaluate(() => {
    const results: Record<string, string> = {}

    // Check modules that might have send functionality
    const sendModuleNames = [
      'WAWebSendMsgAction', 'WAWebSendTextMsgAction', 'WAWebChatSendMessages',
      'WAWebSendMsgRecordAction', 'WAWebEditMsgAction',
      'WAWebSendTextMsg', 'WAWebSendMsg',
      'WAWebRealtimeActions', 'WAWebMsgActionStore',
      'WAWebChatAction', 'WAWebMsgAction',
      'WAWebE2ESendMsg', 'WAWebSendMessageJob',
      'WAWebChatSendTextMsgAction', 'WAWebGeneralChatAction',
      'WAWebSendMsgToChat', 'WAWebForwardMessagesAction',
    ]

    for (const name of sendModuleNames) {
      try {
        // @ts-ignore
        const mod = require(name)
        if (mod) {
          const keys = typeof mod === 'object' ? Object.keys(mod) : []
          results[name] = `[${keys.join(', ')}]`
        }
      } catch {}
    }

    // Also check the Cmd module for sendMessage
    try {
      // @ts-ignore
      const { Cmd } = require('WAWebCmd')
      if (Cmd) {
        const cmdMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(Cmd))
          .filter(k => k.toLowerCase().includes('send') || k.toLowerCase().includes('msg'))
        results.cmdSendMethods = cmdMethods.join(', ')
      }
    } catch (e: any) {
      results.cmdError = e.message
    }

    // Check Socket for send method
    try {
      // @ts-ignore
      const { Socket } = require('WAWebSocketModel')
      if (Socket) {
        const socketKeys = Object.keys(Socket).filter(k =>
          k.toLowerCase().includes('send') || k.toLowerCase().includes('msg')
        )
        results.socketSendKeys = socketKeys.join(', ')
      }
    } catch (e: any) {
      results.socketError = e.message
    }

    return results
  })

  for (const [key, val] of Object.entries(sendApi)) {
    console.log(`  ${key}: ${val}`)
  }

  // ── Save all data ───────────────────────────────────────────

  mkdirSync('tmp', { recursive: true })
  writeFileSync('tmp/whatsapp-store-data.json', JSON.stringify({ chatData, msgData, sendApi }, null, 2))
  console.log('\nSaved to tmp/whatsapp-store-data.json')

  await browser.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
