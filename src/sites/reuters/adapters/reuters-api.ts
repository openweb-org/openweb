import type { Page } from 'patchright'

import type { AdapterHelpers } from '../../../types/adapter.js'

/* Reuters — thin adapter.
 * Reuters' internal PF API (/pf/api/v3/content/fetch/*) is DataDome-protected
 * and only responds to same-origin browser fetches. Spec-based
 * page_global_data expressions cannot call fetch(), so PF API ops stay here
 * using the pageFetch helper.
 * getArticleDetail stays here too because article_url contains slashes that
 * would be percent-encoded by the spec's page_url template substitution. */

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
  return `https://www.reuters.com/pf/api/v3/content/fetch/${fetcher}?query=${q}&_website=reuters`
}

async function pfFetch(
  page: Page,
  helpers: AdapterHelpers,
  fetcher: string,
  query: Record<string, unknown>,
): Promise<unknown> {
  const url = pfUrl(fetcher, query)
  const { status, text } = await helpers.pageFetch(page, {
    url,
    method: 'GET',
    credentials: 'same-origin',
    timeout: 15_000,
  })
  if (status >= 200 && status < 300) {
    try {
      return JSON.parse(text)
    } catch {
      throw helpers.errors.apiError(`Reuters ${fetcher}`, 'Response is not valid JSON')
    }
  }
  const isDD = text.includes('captcha-delivery.com') || text.includes('datadome')
  if (isDD || status === 401) {
    throw helpers.errors.botBlocked(
      `Reuters API blocked by DataDome (HTTP ${status}). Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run \`openweb browser restart\`, solve the CAPTCHA, then retry.`,
    )
  }
  if (status === 404 || status >= 500) {
    throw helpers.errors.retriable(`Reuters API returned ${status}`)
  }
  throw helpers.errors.fatal(`Reuters API returned ${status}`)
}

async function searchArticles(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw helpers.errors.missingParam('keyword')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, helpers, 'articles-by-search-v2', {
    keyword, offset, orderby: 'display_date:desc', size, website: 'reuters',
  })
}

async function getTopicArticles(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const sectionId = String(params.section_id ?? '')
  if (!sectionId) throw helpers.errors.missingParam('section_id')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  return pfFetch(page, helpers, 'articles-by-section-alias-or-id-v1', {
    section_id: sectionId, offset, size, website: 'reuters',
  })
}

async function getTopNews(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const size = Number(params.size ?? 10)
  return pfFetch(page, helpers, 'articles-by-section-alias-or-id-v1', {
    section_id: '/home', offset: 0, size, website: 'reuters',
  })
}

async function getArticleDetail(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const articleUrl = String(params.article_url ?? '')
  if (!articleUrl) throw helpers.errors.missingParam('article_url')

  const fullUrl = articleUrl.startsWith('http')
    ? articleUrl
    : `https://www.reuters.com${articleUrl.startsWith('/') ? '' : '/'}${articleUrl}`

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  if (await isDataDomeBlocked(page)) {
    throw helpers.errors.botBlocked(
      'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA, then retry.',
    )
  }

  await page.waitForTimeout(2_000)

  const article = await page.evaluate(() => {
    // Strategy 1: Arc Publishing Fusion SSR data
    const gc = (window as unknown as { Fusion?: { globalContent?: Record<string, unknown> } }).Fusion?.globalContent as Record<string, unknown> | undefined
    const headlines = gc?.headlines as { basic?: string } | undefined
    if (gc && headlines?.basic) {
      const bodyParts = ((gc.content_elements as Array<Record<string, unknown>>) || [])
        .filter((el) => el.type === 'text')
        .map((el) => {
          const div = document.createElement('div')
          div.innerHTML = (el.content as string) || ''
          return div.textContent?.trim() || ''
        })
        .filter(Boolean)

      const credits = gc.credits as { by?: Array<{ name?: string; url?: string }> } | undefined
      const taxonomy = gc.taxonomy as { primary_section?: { name?: string } } | undefined
      const desc = gc.description as { basic?: string } | undefined
      const subheadlines = gc.subheadlines as { basic?: string } | undefined
      const promo = (gc.promo_items as { basic?: { url?: string; caption?: string; alt_text?: string } } | undefined)?.basic

      return {
        id: (gc._id as string) || '',
        title: headlines.basic,
        description: desc?.basic || subheadlines?.basic || '',
        body: bodyParts.join('\n\n'),
        published_time: (gc.first_publish_date as string) || (gc.publish_date as string) || '',
        updated_time: (gc.last_updated_date as string) || '',
        authors: (credits?.by || []).map((a) => ({
          name: a.name || '',
          topic_url: a.url || '',
        })),
        section: taxonomy?.primary_section?.name || '',
        canonical_url: (gc.canonical_url as string) || '',
        word_count: (gc.word_count as number) || 0,
        thumbnail: promo
          ? {
              url: promo.url || '',
              caption: promo.caption || '',
              alt_text: promo.alt_text || '',
            }
          : null,
      }
    }

    // Strategy 2: DOM/meta fallback
    const title = document.querySelector('h1')?.textContent?.trim() || ''
    const descAttr =
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
      description: descAttr,
      body: paras.join('\n\n'),
      published_time: pubTime,
      authors: Array.from(authorMap.values()),
      section,
      canonical_url:
        document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
        window.location.pathname,
    }
  })

  if (!article.title) throw helpers.errors.fatal('Could not extract article content from page')
  return { result: article }
}

const operations: Record<string, (page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) => Promise<unknown>> = {
  searchArticles,
  getTopicArticles,
  getTopNews,
  getArticleDetail,
}

const adapter = {
  name: 'reuters-api',
  description: 'Reuters — PF API ops (DataDome-gated same-origin fetch) + getArticleDetail (page.goto with path slashes)',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('reuters.com')) return true
    if (url.includes('captcha-delivery.com') || url.includes('datadome')) return true
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

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
    const handler = operations[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    if (await isDataDomeBlocked(page)) {
      await page.waitForTimeout(5_000)
      if (await isDataDomeBlocked(page)) {
        throw helpers.errors.botBlocked(
          'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA in the visible Chrome window, then retry.',
        )
      }
      process.stderr.write('DataDome CAPTCHA resolved.\n')
    }
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
