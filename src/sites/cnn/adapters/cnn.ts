import type { Page } from 'patchright'

import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers

async function getHeadlines(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-component-name="card"]')
    const seen = new Set<string>()
    const items: { title: string; url: string; contentType: string | null }[] = []
    for (const card of cards) {
      const link = card.querySelector('a[href]') as HTMLAnchorElement | null
      if (!link) continue
      const href = link.getAttribute('href')
      if (!href || seen.has(href)) continue
      seen.add(href)
      const headlineEl = card.querySelector('.container__headline-text')
      const title = headlineEl?.textContent?.trim()
      if (!title) continue
      items.push({
        title,
        url: href.startsWith('/') ? href : new URL(href).pathname,
        contentType: link.getAttribute('data-link-type') || null,
      })
    }
    return { count: Math.min(items.length, 25), items: items.slice(0, 25) }
  })
}

async function getArticle(page: Page, _params: Params, errors: Errors): Promise<unknown> {
  const result = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    let article: Record<string, unknown> | null = null
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item['@type'] === 'NewsArticle') { article = item; break }
        }
      } catch {}
      if (article) break
    }

    if (article) {
      const authors = (article.author as unknown[] || [])
        .map((a: unknown) => typeof a === 'string' ? a : (a as Record<string, string>)?.name)
        .filter(Boolean)
      return {
        title: (article.headline as string) || null,
        description: (article.description as string) || null,
        author: authors.join(', ') || null,
        publishedAt: (article.datePublished as string) || null,
        modifiedAt: (article.dateModified as string) || null,
        section: ((article.articleSection as string[]) || [])[0] || null,
        body: (article.articleBody as string) || null,
        thumbnail: (article.thumbnailUrl as string) || null,
      }
    }

    const meta = (name: string) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
      return el?.getAttribute('content') || null
    }
    const title = meta('og:title')?.replace(/\s*\|.*$/, '') || null
    if (!title) return null
    return {
      title,
      description: meta('og:description'),
      author: meta('author'),
      publishedAt: null,
      modifiedAt: null,
      section: meta('meta-section'),
      body: null,
      thumbnail: meta('og:image'),
    }
  })

  if (!result) throw errors.retriable('No article or video data found on page')
  return result
}

async function searchArticles(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const poll = (sel: string, ms: number, max: number) =>
      new Promise<void>((res) => {
        let t = 0
        const id = setInterval(() => {
          t += ms
          if (document.querySelectorAll(sel).length > 0 || t >= max) {
            clearInterval(id)
            res()
          }
        }, ms)
      })
    await poll('[data-component-name="card"] .container__headline-text', 200, 8000)
    const cards = document.querySelectorAll('[data-component-name="card"]')
    const items: { title: string; url: string; description: string | null; date: string | null }[] = []
    for (const card of cards) {
      const link = card.querySelector('a[href]') as HTMLAnchorElement | null
      if (!link) continue
      const href = link.getAttribute('href')
      if (!href) continue
      const headlineEl = card.querySelector('.container__headline-text')
      const title = headlineEl?.textContent?.trim()
      if (!title) continue
      items.push({
        title,
        url: href.startsWith('http') ? new URL(href).pathname : href,
        description: card.querySelector('.container__description')?.textContent?.trim() || null,
        date: card.querySelector('.container__date')?.textContent?.trim() || null,
      })
    }
    return { count: items.length, results: items }
  })
}

type Handler = (page: Page, params: Params, errors: Errors) => Promise<unknown>

const operations: Record<string, Handler> = {
  getHeadlines: (page) => getHeadlines(page),
  getArticle,
  searchArticles: (page) => searchArticles(page),
}

const adapter: CustomRunner = {
  name: 'cnn',
  description: 'CNN — headlines, articles, and search with video page fallback and response trimming',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const p = page as Page
    const handler = operations[operation]
    if (!handler) throw helpers.errors.unknownOp(operation, Object.keys(operations))
    return handler(p, params, helpers.errors)
  },
}

export default adapter
