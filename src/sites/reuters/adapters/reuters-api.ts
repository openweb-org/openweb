import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner } from '../../../types/adapter.js'

/* Reuters — adapter with response trimming.
 * PF API is DataDome-protected, same-origin browser fetch only.
 * getArticleDetail navigates to article URL (path contains slashes). */

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

/* ── trimming ── */

type R = Record<string, unknown>

function trimAuthor(a: R): R {
  return { name: (a.name as string) || '', topic_url: (a.topic_url as string) || '' }
}

function trimThumbnail(t: R): R {
  return {
    url: (t.url as string) || '',
    caption: (t.caption as string) || '',
    alt_text: (t.alt_text as string) || '',
  }
}

function trimArticle(raw: R): R {
  const authors = ((raw.authors as R[]) ?? []).map(trimAuthor)
  const thumb = raw.thumbnail as R | undefined
  return {
    id: raw.id,
    title: raw.title || raw.basic_headline,
    description: raw.description,
    canonical_url: raw.canonical_url,
    published_time: raw.published_time,
    updated_time: raw.updated_time ?? null,
    word_count: raw.word_count ?? null,
    read_minutes: raw.read_minutes ?? null,
    authors,
    thumbnail: thumb ? trimThumbnail(thumb) : null,
  }
}

function trimListResponse(raw: unknown): unknown {
  const data = raw as R
  const result = (data.result ?? data) as R
  const articles = ((result.articles as R[]) ?? []).map(trimArticle)
  const pagination = result.pagination as R | undefined
  return {
    result: {
      pagination: pagination
        ? { size: pagination.size, total_size: pagination.total_size }
        : undefined,
      articles,
    },
  }
}

const BOILERPLATE_RE = /(?:\n+(?:Reporting by .+|(?:Our Standards|Compiled by): .+))+\s*$/

function trimArticleBody(body: string): string {
  return body.replace(BOILERPLATE_RE, '').trim()
}

function trimDetailAuthors(authors: R[]): R[] {
  return authors
    .filter((a) => {
      const url = (a.topic_url as string) || ''
      return !url.includes('/sitemap/')
    })
    .map(trimAuthor)
}

async function searchArticles(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw helpers.errors.missingParam('keyword')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  const raw = await pfFetch(page, helpers, 'articles-by-search-v2', {
    keyword, offset, orderby: 'display_date:desc', size, website: 'reuters',
  })
  return trimListResponse(raw)
}

async function getTopicArticles(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const sectionId = String(params.section_id ?? '')
  if (!sectionId) throw helpers.errors.missingParam('section_id')
  const offset = Number(params.offset ?? 0)
  const size = Number(params.size ?? 10)
  const raw = await pfFetch(page, helpers, 'articles-by-section-alias-or-id-v1', {
    section_id: sectionId, offset, size, website: 'reuters',
  })
  return trimListResponse(raw)
}

async function getTopNews(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const size = Number(params.size ?? 10)
  const raw = await pfFetch(page, helpers, 'articles-by-section-alias-or-id-v1', {
    section_id: '/home', offset: 0, size, website: 'reuters',
  })
  return trimListResponse(raw)
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
  if (article.body) article.body = trimArticleBody(article.body)
  if (article.authors) article.authors = trimDetailAuthors(article.authors as unknown as R[])
  return { result: article }
}

const operations: Record<string, (page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) => Promise<unknown>> = {
  searchArticles,
  getTopicArticles,
  getTopNews,
  getArticleDetail,
}

const adapter: CustomRunner = {
  name: 'reuters-api',
  description: 'Reuters — response trimming for all 4 read ops, DataDome-gated PF API + article detail page extraction',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const p = page as Page
    const handler = operations[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    // Fold init: ensure we're on reuters.com (or CAPTCHA page)
    const currentUrl = p.url()
    if (!currentUrl.includes('reuters.com') && !currentUrl.includes('captcha-delivery.com') && !currentUrl.includes('datadome')) {
      await p.goto('https://www.reuters.com', { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {})
    }
    if (await isDataDomeBlocked(p)) {
      await p.waitForTimeout(5_000)
      if (await isDataDomeBlocked(p)) {
        throw helpers.errors.botBlocked(
          'Reuters blocked by DataDome CAPTCHA. Set {"browser":{"headless":false}} in $OPENWEB_HOME/config.json, run `openweb browser restart`, solve the CAPTCHA in the visible Chrome window, then retry.',
        )
      }
      process.stderr.write('DataDome CAPTCHA resolved.\n')
    }
    return handler(p, { ...params }, helpers)
  },
}

export default adapter
