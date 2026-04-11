import type { Page } from 'patchright'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: {
      pageFetch: (page: Page, opts: {
        url: string; method?: 'GET' | 'POST'; body?: string;
        headers?: Record<string, string>; timeout?: number
      }) => Promise<{ status: number; text: string }>
      errors: {
        unknownOp: (op: string, available: string[]) => Error
        missingParam: (name: string) => Error
        httpError: (status: number, body: string) => Error
        apiError: (context: string, message: string) => Error
        needsLogin: () => Error
      }
    },
  ): Promise<unknown>
}

const API_BASE = 'https://trello.com/1'

async function apiFetch(
  page: Page,
  helpers: { pageFetch: CodeAdapter['execute'] extends (p: Page, o: string, pa: unknown, h: infer H) => unknown ? H['pageFetch'] : never },
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  // Trello's same-origin proxy requires the dsc cookie value in the body for mutations
  let requestBody: string | undefined
  let requestHeaders: Record<string, string> | undefined
  if (method !== 'GET') {
    const dsc = await page.evaluate(() => document.cookie.match(/dsc=([^;]+)/)?.[1] ?? '')
    const merged = { ...body, dsc }
    requestBody = JSON.stringify(merged)
    requestHeaders = { 'Content-Type': 'application/json' }
  }

  const result = await helpers.pageFetch(page, {
    url: url.toString(),
    method,
    body: requestBody,
    headers: requestHeaders,
    timeout: 15_000,
  })

  if (result.status === 401) {
    throw Object.assign(new Error('Trello session expired. Run `openweb login trello` to re-authenticate.'), { failureClass: 'needs_login' })
  }
  if (result.status >= 400) {
    throw Object.assign(new Error(`Trello API ${method} ${path}: HTTP ${result.status} — ${result.text.slice(0, 200)}`), { failureClass: 'execution_failed' })
  }

  try {
    return JSON.parse(result.text)
  } catch {
    throw new Error(`Trello API ${method} ${path}: response is not valid JSON`)
  }
}

/* ---------- getBoards ---------- */

async function getBoards(
  page: Page,
  _params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const data = await apiFetch(page, helpers, 'GET', '/members/me/boards', {
    fields: 'name,desc,url,closed,dateLastActivity,shortUrl,idOrganization',
    filter: 'open',
  })
  const boards = data as Array<Record<string, unknown>>
  return {
    count: boards.length,
    boards: boards.map(b => ({
      id: b.id,
      name: b.name,
      description: b.desc || null,
      url: b.url,
      shortUrl: b.shortUrl || null,
      closed: b.closed ?? false,
      dateLastActivity: b.dateLastActivity || null,
      idOrganization: b.idOrganization || null,
    })),
  }
}

/* ---------- getBoard ---------- */

async function getBoard(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const boardId = String(params.boardId ?? '')
  if (!boardId) throw helpers.errors.missingParam('boardId')

  const [board, lists, cards] = await Promise.all([
    apiFetch(page, helpers, 'GET', `/boards/${boardId}`, {
      fields: 'name,desc,url,closed,dateLastActivity,shortUrl,idOrganization,prefs',
    }),
    apiFetch(page, helpers, 'GET', `/boards/${boardId}/lists`, {
      fields: 'name,closed,pos',
      filter: 'open',
    }),
    apiFetch(page, helpers, 'GET', `/boards/${boardId}/cards`, {
      fields: 'name,desc,url,closed,idList,due,labels,pos,shortUrl,dateLastActivity',
      filter: 'open',
    }),
  ])

  const b = board as Record<string, unknown>
  const listArr = lists as Array<Record<string, unknown>>
  const cardArr = cards as Array<Record<string, unknown>>

  return {
    id: b.id,
    name: b.name,
    description: b.desc || null,
    url: b.url,
    shortUrl: b.shortUrl || null,
    closed: b.closed ?? false,
    dateLastActivity: b.dateLastActivity || null,
    lists: listArr.map(l => ({
      id: l.id,
      name: l.name,
      closed: l.closed ?? false,
      pos: l.pos,
    })),
    cards: cardArr.map(c => ({
      id: c.id,
      name: c.name,
      description: c.desc || null,
      url: c.url,
      shortUrl: c.shortUrl || null,
      idList: c.idList,
      due: c.due || null,
      labels: (c.labels as Array<Record<string, unknown>> | undefined)?.map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })) ?? [],
      closed: c.closed ?? false,
      dateLastActivity: c.dateLastActivity || null,
    })),
  }
}

/* ---------- getLists ---------- */

async function getLists(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const boardId = String(params.boardId ?? '')
  if (!boardId) throw helpers.errors.missingParam('boardId')

  const data = await apiFetch(page, helpers, 'GET', `/boards/${boardId}/lists`, {
    fields: 'name,closed,pos,idBoard',
    filter: 'open',
  })
  const lists = data as Array<Record<string, unknown>>
  return {
    count: lists.length,
    lists: lists.map(l => ({
      id: l.id,
      name: l.name,
      closed: l.closed ?? false,
      pos: l.pos,
      idBoard: l.idBoard,
    })),
  }
}

/* ---------- getCards ---------- */

async function getCards(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const listId = String(params.listId ?? '')
  if (!listId) throw helpers.errors.missingParam('listId')

  const data = await apiFetch(page, helpers, 'GET', `/lists/${listId}/cards`, {
    fields: 'name,desc,url,closed,idList,due,labels,pos,shortUrl,dateLastActivity,idMembers',
  })
  const cards = data as Array<Record<string, unknown>>
  return {
    count: cards.length,
    cards: cards.map(c => ({
      id: c.id,
      name: c.name,
      description: c.desc || null,
      url: c.url,
      shortUrl: c.shortUrl || null,
      idList: c.idList,
      due: c.due || null,
      labels: (c.labels as Array<Record<string, unknown>> | undefined)?.map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })) ?? [],
      closed: c.closed ?? false,
      dateLastActivity: c.dateLastActivity || null,
      idMembers: c.idMembers ?? [],
    })),
  }
}

/* ---------- createCard ---------- */

async function createCard(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const idList = String(params.idList ?? '')
  if (!idList) throw helpers.errors.missingParam('idList')
  const name = String(params.name ?? '')
  if (!name) throw helpers.errors.missingParam('name')

  const body: Record<string, unknown> = { idList, name }
  if (params.desc) body.desc = String(params.desc)
  if (params.due) body.due = String(params.due)
  if (params.pos) body.pos = params.pos

  const card = (await apiFetch(page, helpers, 'POST', '/cards', undefined, body)) as Record<string, unknown>

  return {
    id: card.id,
    name: card.name,
    description: card.desc || null,
    url: card.url,
    shortUrl: card.shortUrl || null,
    idList: card.idList,
    due: card.due || null,
    closed: card.closed ?? false,
    dateLastActivity: card.dateLastActivity || null,
  }
}

/* ---------- deleteCard ---------- */

async function deleteCard(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const cardId = String(params.cardId ?? '')
  if (!cardId) throw helpers.errors.missingParam('cardId')

  await apiFetch(page, helpers, 'DELETE', `/cards/${cardId}`)

  return { deleted: true, cardId }
}

/* ---------- archiveCard ---------- */

async function archiveCard(
  page: Page,
  params: Readonly<Record<string, unknown>>,
  helpers: Parameters<CodeAdapter['execute']>[3],
): Promise<unknown> {
  const cardId = String(params.cardId ?? '')
  if (!cardId) throw helpers.errors.missingParam('cardId')

  const card = (await apiFetch(page, helpers, 'PUT', `/cards/${cardId}`, undefined, { closed: true })) as Record<string, unknown>

  return {
    id: card.id,
    name: card.name,
    closed: card.closed ?? true,
    url: card.url,
    dateLastActivity: card.dateLastActivity || null,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>, helpers: Parameters<CodeAdapter['execute']>[3]) => Promise<unknown>> = {
  getBoards,
  getBoard,
  getLists,
  getCards,
  createCard,
  deleteCard,
  archiveCard,
}

const adapter: CodeAdapter = {
  name: 'trello-api',
  description: 'Trello REST API — boards, lists, cards via cookie session',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('trello.com') || url === 'about:blank'
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const hasCookie = await page.evaluate(() => document.cookie.includes('token'))
    return hasCookie
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Parameters<CodeAdapter['execute']>[3]): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation, Object.keys(OPERATIONS))
    return handler(page, params, helpers)
  },
}

export default adapter
