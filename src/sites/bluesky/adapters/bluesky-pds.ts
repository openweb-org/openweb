import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

const STORAGE_KEY = 'BSKY_STORAGE'

interface BskySession {
  session: {
    currentAccount: {
      did: string
      accessJwt: string
      pdsUrl?: string
      service?: string
    }
  }
}

type Errors = AdapterHelpers['errors']

async function readSession(page: Page): Promise<BskySession | undefined> {
  const raw = await page.evaluate((key: string) => window.localStorage.getItem(key), STORAGE_KEY)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as BskySession
  } catch {
    return undefined
  }
}

function getPdsUrl(session: BskySession): string {
  const account = session.session.currentAccount
  const url = account.pdsUrl || account.service
  if (!url) throw new Error('No PDS URL in session — re-login to bsky.app')
  return url.replace(/\/$/, '')
}

function getDid(session: BskySession): string {
  return session.session.currentAccount.did
}

function extractRkey(atUri: string): string {
  const parts = atUri.split('/')
  return parts[parts.length - 1]
}

function toQueryString(params: Readonly<Record<string, unknown>>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  return qs.toString()
}

async function pdsGet(page: Page, url: string, jwt: string, errors: Errors): Promise<unknown> {
  const result = await page.evaluate(
    async (args: { url: string; jwt: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const r = await fetch(args.url, {
          headers: { Authorization: `Bearer ${args.jwt}` },
          signal: ctrl.signal,
        })
        return { status: r.status, text: await r.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { url, jwt },
  )

  if (result.status >= 400) {
    if (isTokenError(result)) throw errors.needsLogin()
    throw errors.httpError(result.status)
  }

  return JSON.parse(result.text)
}

async function pdsPost(page: Page, url: string, body: unknown, jwt: string, errors: Errors): Promise<unknown> {
  const result = await page.evaluate(
    async (args: { url: string; body: string; jwt: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const r = await fetch(args.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${args.jwt}`,
            'Content-Type': 'application/json',
          },
          body: args.body,
          signal: ctrl.signal,
        })
        const text = await r.text()
        return { status: r.status, text }
      } finally {
        clearTimeout(timer)
      }
    },
    { url, body: JSON.stringify(body), jwt },
  )

  if (result.status >= 400) {
    if (isTokenError(result)) throw errors.needsLogin()
    throw errors.httpError(result.status)
  }

  return result.text ? JSON.parse(result.text) : { success: true }
}

function isTokenError(result: { status: number; text: string }): boolean {
  if (result.status === 401 || result.status === 403) return true
  if (result.status === 400) {
    try {
      const body = JSON.parse(result.text)
      if (body.error === 'ExpiredToken' || body.error === 'InvalidToken') return true
    } catch { /* not JSON */ }
  }
  return false
}

async function requireSession(page: Page, errors: Errors): Promise<{ pds: string; jwt: string; did: string }> {
  const session = await readSession(page)
  if (!session) throw errors.needsLogin()
  return { pds: getPdsUrl(session), jwt: session.session.currentAccount.accessJwt, did: getDid(session) }
}

async function createRecord(page: Page, collection: string, record: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const { pds, jwt, did } = await requireSession(page, errors)
  return pdsPost(page, `${pds}/xrpc/com.atproto.repo.createRecord`, { repo: did, collection, record }, jwt, errors)
}

async function deleteRecord(page: Page, collection: string, rkey: string, errors: Errors): Promise<unknown> {
  const { pds, jwt, did } = await requireSession(page, errors)
  await pdsPost(page, `${pds}/xrpc/com.atproto.repo.deleteRecord`, { repo: did, collection, rkey }, jwt, errors)
  return { success: true }
}

/* --- operations --- */

type OpHandler = (page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  async searchPosts(page, params, errors) {
    const { pds, jwt } = await requireSession(page, errors)
    return pdsGet(page, `${pds}/xrpc/app.bsky.feed.searchPosts?${toQueryString(params)}`, jwt, errors)
  },

  async createPost(page, params, errors) {
    const text = params.text as string | undefined
    if (!text) throw new Error('text is required')
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    }
    if (params.langs) record.langs = params.langs
    if (params.replyTo) {
      const rt = params.replyTo as { uri: string; cid: string; rootUri?: string; rootCid?: string }
      record.reply = {
        parent: { uri: rt.uri, cid: rt.cid },
        root: { uri: rt.rootUri || rt.uri, cid: rt.rootCid || rt.cid },
      }
    }
    return createRecord(page, 'app.bsky.feed.post', record, errors)
  },

  async deletePost(page, params, errors) {
    const uri = params.uri as string | undefined
    if (!uri) throw new Error('uri is required')
    return deleteRecord(page, 'app.bsky.feed.post', extractRkey(uri), errors)
  },

  async likePost(page, params, errors) {
    const uri = params.uri as string | undefined
    const cid = params.cid as string | undefined
    if (!uri || !cid) throw new Error('uri and cid are required')
    return createRecord(page, 'app.bsky.feed.like', {
      $type: 'app.bsky.feed.like',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    }, errors)
  },

  async unlikePost(page, params, errors) {
    const uri = params.uri as string | undefined
    if (!uri) throw new Error('uri is required')
    return deleteRecord(page, 'app.bsky.feed.like', extractRkey(uri), errors)
  },

  async repost(page, params, errors) {
    const uri = params.uri as string | undefined
    const cid = params.cid as string | undefined
    if (!uri || !cid) throw new Error('uri and cid are required')
    return createRecord(page, 'app.bsky.feed.repost', {
      $type: 'app.bsky.feed.repost',
      subject: { uri, cid },
      createdAt: new Date().toISOString(),
    }, errors)
  },

  async unrepost(page, params, errors) {
    const uri = params.uri as string | undefined
    if (!uri) throw new Error('uri is required')
    return deleteRecord(page, 'app.bsky.feed.repost', extractRkey(uri), errors)
  },

  async follow(page, params, errors) {
    const subject = params.subject as string | undefined
    if (!subject) throw new Error('subject (DID) is required')
    return createRecord(page, 'app.bsky.graph.follow', {
      $type: 'app.bsky.graph.follow',
      subject,
      createdAt: new Date().toISOString(),
    }, errors)
  },

  async unfollow(page, params, errors) {
    const uri = params.uri as string | undefined
    if (!uri) throw new Error('uri is required')
    return deleteRecord(page, 'app.bsky.graph.follow', extractRkey(uri), errors)
  },

  async blockUser(page, params, errors) {
    const subject = params.subject as string | undefined
    if (!subject) throw new Error('subject (DID) is required')
    return createRecord(page, 'app.bsky.graph.block', {
      $type: 'app.bsky.graph.block',
      subject,
      createdAt: new Date().toISOString(),
    }, errors)
  },

  async unblockUser(page, params, errors) {
    const uri = params.uri as string | undefined
    if (!uri) throw new Error('uri is required')
    return deleteRecord(page, 'app.bsky.graph.block', extractRkey(uri), errors)
  },

  async muteUser(page, params, errors) {
    const actor = params.actor as string | undefined
    if (!actor) throw new Error('actor is required')
    const { pds, jwt } = await requireSession(page, errors)
    await pdsPost(page, `${pds}/xrpc/app.bsky.graph.muteActor`, { actor }, jwt, errors)
    return { success: true }
  },

  async unmuteUser(page, params, errors) {
    const actor = params.actor as string | undefined
    if (!actor) throw new Error('actor is required')
    const { pds, jwt } = await requireSession(page, errors)
    await pdsPost(page, `${pds}/xrpc/app.bsky.graph.unmuteActor`, { actor }, jwt, errors)
    return { success: true }
  },

  async getNotifications(page, params, errors) {
    const { pds, jwt } = await requireSession(page, errors)
    return pdsGet(page, `${pds}/xrpc/app.bsky.notification.listNotifications?${toQueryString(params)}`, jwt, errors)
  },
}

const runner: CustomRunner = {
  name: 'bluesky-pds',
  description: 'Bluesky operations via user PDS (dynamic server URL from localStorage)',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('bluesky-pds requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers.errors)
  },
}

export default runner
