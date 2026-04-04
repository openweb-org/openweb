import type { Page } from 'playwright-core'
import type { CodeAdapter } from '../../../types/adapter.js'

const APP_URL = 'https://bsky.app'
const STORAGE_KEY = 'BSKY_STORAGE'

interface BskySession {
  session: {
    currentAccount: {
      accessJwt: string
      pdsUrl?: string
      service?: string
    }
  }
}

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

async function pdsFetch(page: Page, endpoint: string, qs: string, jwt: string): Promise<unknown> {
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
    { url: `${endpoint}?${qs}`, jwt },
  )

  if (result.status >= 400) {
    throw Object.assign(
      new Error(`HTTP ${result.status}`),
      { failureClass: result.status === 401 || result.status === 403 ? 'needs_login' : 'fatal' },
    )
  }

  return JSON.parse(result.text)
}

function toQueryString(params: Readonly<Record<string, unknown>>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  return qs.toString()
}

/* --- operations --- */

async function searchPosts(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const session = await readSession(page)
  if (!session) throw Object.assign(new Error('Not logged in to bsky.app'), { failureClass: 'needs_login' })
  const pds = getPdsUrl(session)
  const jwt = session.session.currentAccount.accessJwt
  return pdsFetch(page, `${pds}/xrpc/app.bsky.feed.searchPosts`, toQueryString(params), jwt)
}

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchPosts,
}

const adapter: CodeAdapter = {
  name: 'bluesky-pds',
  description: 'Bluesky operations via user PDS (dynamic server URL from localStorage)',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('bsky.app')) return true
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 15_000 })
    await new Promise(r => setTimeout(r, 3_000))
    return page.url().includes('bsky.app')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const session = await readSession(page)
    return !!session?.session?.currentAccount?.accessJwt
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw new Error(`Unknown operation: ${operation}. Available: ${Object.keys(OPERATIONS).join(', ')}`)
    return handler(page, params)
  },
}

export default adapter
