import type { Page } from 'playwright-core'
import type { CodeAdapter } from '../../../types/adapter.js'

const MOVIE_ORIGIN = 'https://movie.douban.com'
const BOOK_ORIGIN = 'https://book.douban.com'
const SEARCH_ORIGIN = 'https://search.douban.com'

async function searchMovies(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query parameter is required')
  const start = Number(params.start ?? 0)

  const url = `${SEARCH_ORIGIN}/movie/subject_search?search_text=${encodeURIComponent(query)}&cat=1002&start=${start}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.item-root', { timeout: 8000 }).catch(() => null)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.item-root')).map((el) => {
      const titleEl = el.querySelector('.title a')
      const href = titleEl?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)\//)
      return {
        id: idMatch ? Number(idMatch[1]) : null,
        title: titleEl?.textContent?.trim() ?? null,
        url: href || null,
        rating: el.querySelector('.rating_nums')?.textContent?.trim() || null,
        ratingCount: el.querySelector('.rating .pl')?.textContent?.trim() || null,
        abstract: el.querySelector('.abstract')?.textContent?.trim() || null,
        cover: el.querySelector('img')?.getAttribute('src') ?? null,
      }
    })
    return { query: new URLSearchParams(window.location.search).get('search_text'), count: items.length, items }
  })
}

async function getMovieDetail(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${MOVIE_ORIGIN}/subject/${id}/`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    // Prefer JSON-LD for structured data
    const ldScript = document.querySelector('script[type="application/ld+json"]')
    const ld = ldScript ? (() => { try { return JSON.parse(ldScript.textContent!) } catch { return null } })() : null

    const rating = ld?.aggregateRating
    const idMatch = window.location.pathname.match(/\/subject\/(\d+)/)

    return {
      id: idMatch ? Number(idMatch[1]) : null,
      title: ld?.name ?? document.querySelector('#content h1 span')?.textContent?.trim() ?? null,
      year: document.querySelector('#content h1 .year')?.textContent?.replace(/[()]/g, '').trim() || null,
      rating: rating?.ratingValue ? Number(rating.ratingValue) : null,
      ratingCount: rating?.ratingCount ? Number(rating.ratingCount) : null,
      genres: ld?.genre ?? Array.from(document.querySelectorAll('[property="v:genre"]')).map((e) => e.textContent),
      directors: (ld?.director ?? []).map((d: Record<string, string>) => d.name),
      actors: (ld?.actor ?? []).slice(0, 10).map((a: Record<string, string>) => a.name),
      duration: ld?.duration ?? null,
      datePublished: ld?.datePublished ?? null,
      description: ld?.description ?? document.querySelector('[property="v:summary"]')?.textContent?.trim() ?? null,
      poster: ld?.image ?? document.querySelector('#mainpic img')?.getAttribute('src') ?? null,
      url: ld?.url ? `https://movie.douban.com${ld.url}` : window.location.href,
    }
  })
}

async function getMovieComments(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')
  const start = Number(params.start ?? 0)
  const limit = Number(params.limit ?? 20)
  const status = String(params.status ?? 'P')

  await page.goto(`${MOVIE_ORIGIN}/subject/${id}/comments?start=${start}&limit=${limit}&status=${status}&sort=new_score`, {
    waitUntil: 'domcontentloaded',
  })

  return page.evaluate(() => {
    const movieTitle = document.querySelector('#content h1')?.textContent?.trim()?.replace(/\s*短评$/, '') ?? null
    const comments = Array.from(document.querySelectorAll('.comment-item')).map((el) => {
      const ratingClass = el.querySelector('.comment-info .rating')?.className ?? ''
      const starMatch = ratingClass.match(/allstar(\d+)/)
      const stars = starMatch ? Number(starMatch[1]) / 10 : null
      return {
        author: el.querySelector('.comment-info a')?.textContent?.trim() ?? null,
        rating: stars,
        ratingLabel: el.querySelector('.comment-info .rating')?.getAttribute('title') ?? null,
        time: el.querySelector('.comment-info .comment-time')?.textContent?.trim() ?? null,
        content: el.querySelector('.short')?.textContent?.trim() ?? null,
        votes: Number(el.querySelector('.comment-vote .votes')?.textContent?.trim() ?? '0'),
      }
    })
    return { movieTitle, commentCount: comments.length, comments }
  })
}

async function getTopMovies(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const start = Number(params.start ?? 0)

  await page.goto(`${MOVIE_ORIGIN}/top250?start=${start}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const movies = Array.from(document.querySelectorAll('.item')).map((el) => {
      const href = el.querySelector('.hd a')?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)\//)
      const ratingCountText = el.querySelector('.bd div span:nth-child(4)')?.textContent?.trim() ?? ''
      const countMatch = ratingCountText.match(/([\d]+)/)
      return {
        rank: Number(el.querySelector('.pic em')?.textContent?.trim() ?? '0'),
        id: idMatch ? Number(idMatch[1]) : null,
        title: el.querySelector('.hd a .title')?.textContent?.trim() ?? null,
        otherTitle: el.querySelector('.hd a .other')?.textContent?.trim()?.replace(/^\s*\/\s*/, '') || null,
        rating: Number(el.querySelector('.rating_num')?.textContent?.trim() ?? '0'),
        ratingCount: countMatch ? Number(countMatch[1]) : null,
        quote: el.querySelector('.quote span')?.textContent?.trim() || null,
        url: href || null,
        cover: el.querySelector('.pic img')?.getAttribute('src') ?? null,
      }
    })
    return { start: Number(new URLSearchParams(window.location.search).get('start') ?? '0'), count: movies.length, movies }
  })
}

async function searchBooks(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query parameter is required')
  const start = Number(params.start ?? 0)

  const url = `${SEARCH_ORIGIN}/book/subject_search?search_text=${encodeURIComponent(query)}&cat=1001&start=${start}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.item-root', { timeout: 8000 }).catch(() => null)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.item-root')).map((el) => {
      const titleEl = el.querySelector('.title a')
      const href = titleEl?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)\//)
      return {
        id: idMatch ? Number(idMatch[1]) : null,
        title: titleEl?.textContent?.trim() ?? null,
        url: href || null,
        rating: el.querySelector('.rating_nums')?.textContent?.trim() || null,
        ratingCount: el.querySelector('.rating .pl')?.textContent?.trim() || null,
        abstract: el.querySelector('.abstract')?.textContent?.trim() || null,
        cover: el.querySelector('img')?.getAttribute('src') ?? null,
      }
    })
    return { query: new URLSearchParams(window.location.search).get('search_text'), count: items.length, items }
  })
}

async function getBookDetail(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${BOOK_ORIGIN}/subject/${id}/`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const ldScript = document.querySelector('script[type="application/ld+json"]')
    const ld = ldScript ? (() => { try { return JSON.parse(ldScript.textContent!) } catch { return null } })() : null

    const infoEl = document.querySelector('#info')
    const infoText = infoEl?.textContent ?? ''
    const extractInfo = (label: string): string | null => {
      const re = new RegExp(`${label}:\\s*(.+?)\\n`)
      const match = infoText.match(re)
      return match ? match[1].trim() : null
    }

    const idMatch = window.location.pathname.match(/\/subject\/(\d+)/)

    return {
      id: idMatch ? Number(idMatch[1]) : null,
      title: ld?.name ?? document.querySelector('#wrapper h1 span')?.textContent?.trim() ?? null,
      authors: (ld?.author ?? []).map((a: Record<string, string>) => a.name),
      isbn: ld?.isbn ?? null,
      rating: Number(document.querySelector('[property="v:average"]')?.textContent?.trim() ?? '0') || null,
      ratingCount: Number(document.querySelector('[property="v:votes"]')?.textContent?.trim() ?? '0') || null,
      publisher: extractInfo('出版社'),
      publishDate: extractInfo('出版年'),
      pages: extractInfo('页数'),
      price: extractInfo('定价'),
      binding: extractInfo('装帧'),
      translator: extractInfo('译者'),
      summary:
        (document.querySelector('#link-report .all .intro') || document.querySelector('#link-report .intro'))?.textContent?.trim() ?? null,
      cover: document.querySelector('#mainpic img')?.getAttribute('src') ?? null,
      url: window.location.href,
    }
  })
}

async function getBookComments(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')
  const start = Number(params.start ?? 0)

  await page.goto(`${BOOK_ORIGIN}/subject/${id}/comments/?start=${start}&status=P&sort=new_score`, {
    waitUntil: 'domcontentloaded',
  })

  return page.evaluate(() => {
    const bookTitle = document.querySelector('#content h1')?.textContent?.trim()?.replace(/\s*短评$/, '') ?? null
    const comments = Array.from(document.querySelectorAll('.comment-item')).map((el) => {
      const ratingClass = el.querySelector('.comment-info .rating')?.className ?? ''
      const starMatch = ratingClass.match(/allstar(\d+)/)
      const stars = starMatch ? Number(starMatch[1]) / 10 : null
      return {
        author: el.querySelector('.comment-info a')?.textContent?.trim() ?? null,
        rating: stars,
        ratingLabel: el.querySelector('.comment-info .rating')?.getAttribute('title') ?? null,
        time: el.querySelector('.comment-info .comment-time')?.textContent?.trim() ?? null,
        content: el.querySelector('.short')?.textContent?.trim() ?? null,
        votes: Number(el.querySelector('.comment-vote .votes')?.textContent?.trim() ?? '0'),
      }
    })
    return { bookTitle, commentCount: comments.length, comments }
  })
}

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchMovies,
  getMovieDetail,
  getMovieComments,
  getTopMovies,
  searchBooks,
  getBookDetail,
  getBookComments,
}

const adapter: CodeAdapter = {
  name: 'douban-dom',
  description: 'Douban DOM extraction — movies, books, search, comments, top charts',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('douban.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // Douban public data requires no auth
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}. Available: ${Object.keys(OPERATIONS).join(', ')}`)
    }
    return handler(page, params)
  },
}

export default adapter
