import type { Page } from 'playwright-core'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

function validationError(msg: string): Error {
  return Object.assign(new Error(msg), { failureClass: 'fatal' })
}

function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

function pfUrl(fetcher: string, query: Record<string, unknown>): string {
  const q = encodeURIComponent(JSON.stringify(query))
  return `/pf/api/v3/content/fetch/${fetcher}?query=${q}&_website=reuters`
}

async function pfFetch(page: Page, fetcher: string, query: Record<string, unknown>): Promise<unknown> {
  const url = pfUrl(fetcher, query)
  const result = await page.evaluate(async (u: string) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(u, { credentials: 'same-origin', signal: ctrl.signal })
      if (!r.ok) return { __error: true, status: r.status }
      return JSON.parse(await r.text())
    } finally {
      clearTimeout(timer)
    }
  }, url)
  if (result && typeof result === 'object' && '__error' in result) {
    const err = result as { status: number }
    throw Object.assign(new Error(`Reuters API returned ${err.status}`), {
      failureClass: err.status === 401 ? 'needs_login' : 'fatal',
    })
  }
  return result
}

async function searchArticles(page: Page, params: Record<string, unknown>) {
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw validationError('keyword is required')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, 'articles-by-search-v2', {
    keyword, offset, orderby: 'display_date:desc', size, website: 'reuters',
  })
}

async function getTopicArticles(page: Page, params: Record<string, unknown>) {
  const sectionId = String(params.section_id ?? '')
  if (!sectionId) throw validationError('section_id is required (e.g., /world/, /business/, /technology/)')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, 'articles-by-section-alias-or-id-v1', {
    section_id: sectionId, offset, size, website: 'reuters',
  })
}

async function getMarketQuotes(page: Page, params: Record<string, unknown>) {
  const rics = String(params.rics ?? '')
  if (!rics) throw validationError('rics is required (comma-separated RIC codes, e.g., .SPX,.DJI,.IXIC)')
  return pfFetch(page, 'quote-by-rics-v2', {
    fields: 'ric,type:ricType,name,currency,localName{long{name,lang},short{name,lang}}last,percent_change:pctChange',
    retries: 0,
    rics,
  })
}

const operations: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchArticles,
  getTopicArticles,
  getMarketQuotes,
}

const adapter: CodeAdapter = {
  name: 'reuters-api',
  description: 'Reuters — search articles, read article content, browse topics, get market quotes',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('reuters.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true // Public API, no auth needed (uses browser session cookies for API access)
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = operations[operation]
    if (!handler) throw unknownOpError(operation)
    return handler(page, { ...params })
  },
}

export default adapter
