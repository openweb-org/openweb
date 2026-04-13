import type { Page } from 'patchright'

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  botBlocked(msg: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
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

async function pfFetch(
  page: Page,
  fetcher: string,
  query: Record<string, unknown>,
  errors: Errors,
): Promise<unknown> {
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
      throw errors.botBlocked(
        `Reuters API blocked by DataDome (HTTP ${err.status}). Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run \`openweb browser restart\`, solve the CAPTCHA, then retry.`,
      )
    }
    const isTransient = err.status === 404 || err.status >= 500
    if (isTransient) throw errors.retriable(`Reuters API returned ${err.status}`)
    throw errors.fatal(`Reuters API returned ${err.status}`)
  }
  return result
}

async function searchArticles(page: Page, params: Record<string, unknown>, errors: AdapterErrorHelpers) {
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw errors.missingParam('keyword')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, 'articles-by-search-v2', {
    keyword, offset, orderby: 'display_date:desc', size, website: 'reuters',
  }, errors)
}

async function getTopicArticles(page: Page, params: Record<string, unknown>, errors: AdapterErrorHelpers) {
  const sectionId = String(params.section_id ?? '')
  if (!sectionId) throw errors.missingParam('section_id')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, 'articles-by-section-alias-or-id-v1', {
    section_id: sectionId, offset, size, website: 'reuters',
  }, errors)
}

async function getArticleDetail(page: Page, params: Record<string, unknown>, errors: AdapterErrorHelpers) {
  const articleUrl = String(params.article_url ?? '')
  if (!articleUrl) throw errors.missingParam('article_url')

  const fullUrl = articleUrl.startsWith('http')
    ? articleUrl
    : `https://www.reuters.com${articleUrl.startsWith('/') ? '' : '/'}${articleUrl}`

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  if (await isDataDomeBlocked(page)) {
    throw errors.botBlocked(
      'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA, then retry.',
    )
  }

  await page.waitForTimeout(2_000)

  const article = await page.evaluate(() => {
    // Strategy 1: Arc Publishing Fusion SSR data
    const gc = (window as any).Fusion?.globalContent
    if (gc?.headlines?.basic) {
      const bodyParts = (gc.content_elements || [])
        .filter((el: any) => el.type === 'text')
        .map((el: any) => {
          const div = document.createElement('div')
          div.innerHTML = el.content || ''
          return div.textContent?.trim() || ''
        })
        .filter(Boolean)

      return {
        id: gc._id || '',
        title: gc.headlines.basic,
        description: gc.description?.basic || gc.subheadlines?.basic || '',
        body: bodyParts.join('\n\n'),
        published_time: gc.first_publish_date || gc.publish_date || '',
        updated_time: gc.last_updated_date || '',
        authors: (gc.credits?.by || []).map((a: any) => ({
          name: a.name || '',
          topic_url: a.url || '',
        })),
        section: gc.taxonomy?.primary_section?.name || '',
        canonical_url: gc.canonical_url || '',
        word_count: gc.word_count || 0,
        thumbnail: gc.promo_items?.basic
          ? {
              url: gc.promo_items.basic.url || '',
              caption: gc.promo_items.basic.caption || '',
              alt_text: gc.promo_items.basic.alt_text || '',
            }
          : null,
      }
    }

    // Strategy 2: DOM/meta fallback
    const title = document.querySelector('h1')?.textContent?.trim() || ''
    const desc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
    const paras = Array.from(
      document.querySelectorAll('[data-testid*="paragraph"], article p'),
    )
      .map((p) => p.textContent?.trim())
      .filter(Boolean)
    const pubTime =
      document.querySelector('time')?.getAttribute('datetime') ||
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      ''
    const authorMap = new Map<string, { name: string; topic_url: string }>()
    for (const a of document.querySelectorAll(
      'a[href*="/authors/"], a[href*="/author/"]',
    )) {
      const name = a.textContent?.trim() || ''
      if (name && !authorMap.has(name))
        authorMap.set(name, { name, topic_url: a.getAttribute('href') || '' })
    }
    const section =
      document.querySelector('meta[property="article:section"]')?.getAttribute('content') || ''

    return {
      title,
      description: desc,
      body: paras.join('\n\n'),
      published_time: pubTime,
      authors: Array.from(authorMap.values()),
      section,
      canonical_url:
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
        window.location.pathname,
    }
  })

  if (!article.title) throw errors.fatal('Could not extract article content from page')
  return { result: article }
}

async function getTopNews(page: Page, params: Record<string, unknown>, errors: AdapterErrorHelpers) {
  const size = Number(params.size ?? 10)
  return pfFetch(page, 'articles-by-section-alias-or-id-v1', {
    section_id: '/home', offset: 0, size, website: 'reuters',
  }, errors)
}

const operations: Record<string, (page: Page, params: Record<string, unknown>, errors: AdapterErrorHelpers) => Promise<unknown>> = {
  searchArticles,
  getTopicArticles,
  getArticleDetail,
  getTopNews,
}

const adapter = {
  name: 'reuters-api',
  description: 'Reuters — search articles, browse topics, article detail, top news',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('reuters.com')) return true
    // DataDome captcha redirect means we're in the reuters flow
    if (url.includes('captcha-delivery.com') || url.includes('datadome')) return true
    // Navigate to reuters.com if on a blank or unrelated page
    try {
      await page.goto('https://www.reuters.com', { waitUntil: 'domcontentloaded', timeout: 20_000 })
      const newUrl = page.url()
      return newUrl.includes('reuters.com') || newUrl.includes('captcha-delivery.com')
    } catch {
      return false
    }
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = operations[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (await isDataDomeBlocked(page)) {
      // Brief wait for auto-resolution (non-headless browsers may resolve quickly)
      await page.waitForTimeout(5_000)
      if (await isDataDomeBlocked(page)) {
        throw errors.botBlocked(
          'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA in the visible Chrome window, then retry.',
        )
      }
      process.stderr.write('DataDome CAPTCHA resolved.\n')
    }
    return handler(page, { ...params }, errors)
  },
}

export default adapter
