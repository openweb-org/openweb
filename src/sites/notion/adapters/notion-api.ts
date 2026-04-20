import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * Notion adapter — page create/update/delete via submitTransaction.
 *
 * Notion's internal API uses a transaction-based mutation system.
 * This adapter wraps the complex transaction format behind simple
 * params (title, parentId, pageId).
 */

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

/** Build common headers for Notion API calls. Throws needsLogin if user cookie missing. */
async function buildHeaders(page: Page, spaceId: string, helpers: AdapterHelpers): Promise<Record<string, string>> {
  const userId = await getNotionUserId(page)
  if (!userId) throw helpers.errors.needsLogin()
  return {
    'content-type': 'application/json',
    'x-notion-active-user-header': userId,
    'x-notion-space-id': spaceId,
  }
}

async function submitTransaction(
  page: Page,
  helpers: AdapterHelpers,
  spaceId: string,
  operations: unknown[],
): Promise<void> {
  const { errors } = helpers
  const txnId = uuid()
  const body = JSON.stringify({
    requestId: txnId,
    transactions: [{ id: txnId, spaceId, operations }],
  })
  const headers = await buildHeaders(page, spaceId, helpers)
  const resp = await helpers.pageFetch(page, {
    url: `${API_BASE}/submitTransaction`,
    method: 'POST',
    headers,
    body,
  })
  if (resp.status !== 200) {
    throw errors.fatal(`submitTransaction returned ${resp.status}: ${resp.text.slice(0, 800)}`)
  }
}

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async createPage(page, params, helpers) {
    const { errors } = helpers
    const spaceId = String(params['x-notion-space-id'] || '')
    const title = String(params.title || '')
    const parentId = String(params.parentId || '') || spaceId

    if (!spaceId) throw errors.missingParam('x-notion-space-id')
    if (!title) throw errors.missingParam('title')

    const userId = await getNotionUserId(page)
    if (!userId) throw errors.needsLogin()

    const isSubpage = params.parentId && String(params.parentId) !== spaceId
    const parentTable = isSubpage ? 'block' : 'space'
    const newPageId = uuid()
    const now = Date.now()

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
        pointer: { table: 'block', id: newPageId, spaceId },
        command: 'update',
        path: [],
        args: {
          permissions: [
            { type: 'user_permission', role: 'editor', user_id: userId },
          ],
          created_by_table: 'notion_user',
          created_by_id: userId,
          last_edited_by_table: 'notion_user',
          last_edited_by_id: userId,
        },
      },
      {
        pointer: { table: parentTable, id: parentId, spaceId },
        command: 'listAfter',
        path: parentTable === 'space' ? ['pages'] : ['content'],
        args: { id: newPageId },
      },
    ]

    await submitTransaction(page, helpers, spaceId, operations)
    return { pageId: newPageId, title, parentId, parentTable }
  },

  async updatePage(page, params, helpers) {
    const { errors } = helpers
    const spaceId = String(params['x-notion-space-id'] || '')
    const pageId = String(params.pageId || '')
    const title = String(params.title || '')

    if (!spaceId) throw errors.missingParam('x-notion-space-id')
    if (!pageId) throw errors.missingParam('pageId')
    if (!title) throw errors.missingParam('title')

    const now = Date.now()
    const operations = [
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'set',
        path: ['properties', 'title'],
        args: [[title]],
      },
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'set',
        path: ['last_edited_time'],
        args: now,
      },
    ]

    await submitTransaction(page, helpers, spaceId, operations)
    return { pageId, title, updated: true }
  },

  async deletePage(page, params, helpers) {
    const { errors } = helpers
    const spaceId = String(params['x-notion-space-id'] || '')
    const pageId = String(params.pageId || '')

    if (!spaceId) throw errors.missingParam('x-notion-space-id')
    if (!pageId) throw errors.missingParam('pageId')

    const now = Date.now()
    const operations = [
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'update',
        path: [],
        args: { alive: false },
      },
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'set',
        path: ['last_edited_time'],
        args: now,
      },
    ]

    await submitTransaction(page, helpers, spaceId, operations)
    return { pageId, deleted: true }
  },
}

const runner: CustomRunner = {
  name: 'notion-api',
  description: 'Notion — create, update, and delete pages via submitTransaction',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('notion-api requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
