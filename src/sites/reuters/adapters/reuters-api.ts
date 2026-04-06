import type { Page } from 'patchright'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

const REUTERS_ORIGIN = 'https://www.reuters.com'

function validationError(msg: string): Error {
  return Object.assign(new Error(msg), { failureClass: 'fatal' })
}

function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

async function isDataDomeBlocked(page: Page): Promise<boolean> {
  try {
    const url = page.url()
    if (url.includes('captcha-delivery.com') || url.includes('datadome')) return true
    return page.evaluate(() =>
      document.body?.innerHTML?.includes('captcha-delivery.com') ?? false,
    )
  } catch {
    return false
  }
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
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        const isDD = body.includes('captcha-delivery.com') || body.includes('datadome')
        return { __error: true, status: r.status, isDataDome: isDD }
      }
      return JSON.parse(await r.text())
    } finally {
      clearTimeout(timer)
    }
  }, url)
  if (result && typeof result === 'object' && '__error' in result) {
    const err = result as { status: number; isDataDome?: boolean }
    if (err.isDataDome || err.status === 401) {
      throw Object.assign(
        new Error(
          `Reuters API blocked by DataDome (HTTP ${err.status}). Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run \`openweb browser restart\`, solve the CAPTCHA, then retry.`,
        ),
        { failureClass: 'bot_blocked' },
      )
    }
    const isTransient = err.status === 404 || err.status >= 500
    throw Object.assign(new Error(`Reuters API returned ${err.status}`), {
      failureClass: isTransient ? 'retriable' : 'fatal',
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

const operations: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchArticles,
  getTopicArticles,
}

const adapter: CodeAdapter = {
  name: 'reuters-api',
  description: 'Reuters — search articles, browse topics by section',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('reuters.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = operations[operation]
    if (!handler) throw unknownOpError(operation)
    if (await isDataDomeBlocked(page)) {
      // Brief wait for auto-resolution (non-headless browsers may resolve quickly)
      await page.waitForTimeout(5_000)
      if (await isDataDomeBlocked(page)) {
        throw Object.assign(
          new Error(
            'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA in the visible Chrome window, then retry.',
          ),
          { failureClass: 'bot_blocked' },
        )
      }
      process.stderr.write('DataDome CAPTCHA resolved.\n')
    }
    return handler(page, { ...params })
  },
}

export default adapter
