import type { Page } from 'patchright'

/**
 * Notion adapter — page create/update via submitTransaction.
 *
 * Notion's internal API uses a transaction-based mutation system.
 * This adapter wraps the complex transaction format behind simple
 * params (title, parentId, pageId).
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: {
    url: string; method?: string; body?: string;
    headers?: Record<string, string>; timeout?: number
  }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const API_BASE = 'https://www.notion.so/api/v3'

/** Simple UUID v4 generator — no external imports needed. */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

/** Read notion_user_id cookie for the CSRF header. */
async function getNotionUserId(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  const c = cookies.find(ck => ck.name === 'notion_user_id')
  return c?.value || ''
}

/** Build common headers for Notion API calls. */
async function buildHeaders(page: Page, spaceId: string): Promise<Record<string, string>> {
  const userId = await getNotionUserId(page)
  return {
    'content-type': 'application/json',
    'x-notion-active-user-header': userId,
    'x-notion-space-id': spaceId,
  }
}

async function createPage(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const spaceId = String(params['x-notion-space-id'] || '')
  const title = String(params.title || '')
  const parentId = String(params.parentId || '') || spaceId

  if (!spaceId) throw errors.missingParam('x-notion-space-id')
  if (!title) throw errors.missingParam('title')

  const isSubpage = params.parentId && String(params.parentId) !== spaceId
  const parentTable = isSubpage ? 'block' : 'space'
  const newPageId = uuid()
  const now = Date.now()
  const txnId = uuid()

  const operations = [
    {
      pointer: { table: 'block', id: newPageId, spaceId },
      command: 'set',
      path: [],
      args: {
        type: 'page',
        id: newPageId,
        version: 1,
        alive: true,
        parent_id: parentId,
        parent_table: parentTable,
        space_id: spaceId,
        created_time: now,
        last_edited_time: now,
        properties: { title: [[title]] },
      },
    },
    {
      pointer: { table: parentTable, id: parentId, spaceId },
      command: 'listAfter',
      path: parentTable === 'space' ? ['pages'] : ['content'],
      args: { id: newPageId },
    },
  ]

  const body = JSON.stringify({
    requestId: txnId,
    transactions: [{ id: txnId, spaceId, operations }],
  })

  const headers = await buildHeaders(page, spaceId)
  const resp = await helpers.pageFetch(page, {
    url: `${API_BASE}/submitTransaction`,
    method: 'POST',
    headers,
    body,
  })

  if (resp.status !== 200) {
    throw errors.fatal(`submitTransaction returned ${resp.status}: ${resp.text.slice(0, 200)}`)
  }

  return { pageId: newPageId, title, parentId, parentTable }
}

async function updatePage(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const spaceId = String(params['x-notion-space-id'] || '')
  const pageId = String(params.pageId || '')
  const title = String(params.title || '')

  if (!spaceId) throw errors.missingParam('x-notion-space-id')
  if (!pageId) throw errors.missingParam('pageId')
  if (!title) throw errors.missingParam('title')

  const now = Date.now()
  const txnId = uuid()

  const operations = [
    {
      pointer: { table: 'block', id: pageId, spaceId },
      command: 'update',
      path: ['properties', 'title'],
      args: [[title]],
    },
    {
      pointer: { table: 'block', id: pageId, spaceId },
      command: 'update',
      path: ['last_edited_time'],
      args: now,
    },
  ]

  const body = JSON.stringify({
    requestId: txnId,
    transactions: [{ id: txnId, spaceId, operations }],
  })

  const headers = await buildHeaders(page, spaceId)
  const resp = await helpers.pageFetch(page, {
    url: `${API_BASE}/submitTransaction`,
    method: 'POST',
    headers,
    body,
  })

  if (resp.status !== 200) {
    throw errors.fatal(`submitTransaction returned ${resp.status}: ${resp.text.slice(0, 200)}`)
  }

  return { pageId, title, updated: true }
}

async function deletePage(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const spaceId = String(params['x-notion-space-id'] || '')
  const pageId = String(params.pageId || '')

  if (!spaceId) throw errors.missingParam('x-notion-space-id')
  if (!pageId) throw errors.missingParam('pageId')

  const now = Date.now()
  const txnId = uuid()

  const operations = [
    {
      pointer: { table: 'block', id: pageId, spaceId },
      command: 'update',
      path: [],
      args: { alive: false },
    },
    {
      pointer: { table: 'block', id: pageId, spaceId },
      command: 'update',
      path: ['last_edited_time'],
      args: now,
    },
  ]

  const body = JSON.stringify({
    requestId: txnId,
    transactions: [{ id: txnId, spaceId, operations }],
  })

  const headers = await buildHeaders(page, spaceId)
  const resp = await helpers.pageFetch(page, {
    url: `${API_BASE}/submitTransaction`,
    method: 'POST',
    headers,
    body,
  })

  if (resp.status !== 200) {
    throw errors.fatal(`submitTransaction returned ${resp.status}: ${resp.text.slice(0, 200)}`)
  }

  return { pageId, deleted: true }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  createPage,
  updatePage,
  deletePage,
}

const adapter = {
  name: 'notion-api',
  description: 'Notion — create, update, and delete pages via submitTransaction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('notion.so')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const userId = await getNotionUserId(page)
    return userId.length > 0
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Helpers): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
