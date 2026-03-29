/**
 * Douban L3 adapter — DOM extraction from SSR pages.
 *
 * Douban is a traditional server-rendered site. All data is extracted
 * from the DOM via page navigation + evaluate. Covers movie, book,
 * and music across movie.douban.com, book.douban.com, music.douban.com.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { Page } from 'playwright-core'

/* ---------- helpers ---------- */

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(2000)
}

function parseInfoField(text: string, field: string): string {
  const re = new RegExp(`${field}:\\s*(.+?)\\n`)
  return re.exec(text)?.[1]?.trim() ?? ''
}

/* ---------- operation handlers ---------- */

async function searchMovies(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const url = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(query)}&cat=1002`
  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.item-root')).map(el => {
      const titleEl = el.querySelector('.title a')
      const ratingEl = el.querySelector('.rating_nums')
      const metaEl = el.querySelector('.meta')
      const imgEl = el.querySelector('img')
      const href = titleEl?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)/)
      return {
        subjectId: idMatch?.[1] ?? '',
        title: titleEl?.textContent?.trim() ?? '',
        rating: ratingEl?.textContent?.trim() ?? '',
        meta: metaEl?.textContent?.trim() ?? '',
        url: href,
        coverImage: imgEl?.getAttribute('src') ?? '',
      }
    })
    return { results: items, totalResults: items.length }
  })
}

async function getMovieDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  await navigateAndWait(page, `https://movie.douban.com/subject/${subjectId}/`)

  return page.evaluate(() => {
    const infoEl = document.getElementById('info')
    const infoText = infoEl?.textContent ?? ''
    const title = document.querySelector('#content h1 span')?.textContent?.trim() ?? ''
    const year = document.querySelector('#content h1 .year')?.textContent?.trim()?.replace(/[()（）]/g, '') ?? ''
    const rating = document.querySelector('.rating_num')?.textContent?.trim() ?? ''
    const ratingCount = document.querySelector('.rating_people span')?.textContent?.trim() ?? ''
    const summary = document.querySelector('[property="v:summary"]')?.textContent?.trim() ??
      document.querySelector('.related-info .indent span')?.textContent?.trim() ?? ''
    const poster = document.querySelector('#mainpic img')?.getAttribute('src') ?? ''

    const director = Array.from(infoEl?.querySelectorAll('[rel="v:directedBy"]') ?? []).map(e => e.textContent?.trim() ?? '')
    const actors = Array.from(infoEl?.querySelectorAll('[rel="v:starring"]') ?? []).map(e => e.textContent?.trim() ?? '')
    const genre = Array.from(infoEl?.querySelectorAll('[property="v:genre"]') ?? []).map(e => e.textContent?.trim() ?? '')
    const runtime = infoEl?.querySelector('[property="v:runtime"]')?.textContent?.trim() ?? ''
    const releaseDate = Array.from(infoEl?.querySelectorAll('[property="v:initialReleaseDate"]') ?? []).map(e => e.textContent?.trim() ?? '')

    const countryMatch = infoText.match(/制片国家\/地区:\s*(.+?)\n/)
    const langMatch = infoText.match(/语言:\s*(.+?)\n/)
    const aliasMatch = infoText.match(/又名:\s*(.+?)\n/)
    const imdbMatch = infoText.match(/IMDb:\s*(tt\d+)/)
    const writerMatch = infoText.match(/编剧:\s*(.+?)\n/)

    const stars = Array.from(document.querySelectorAll('.ratings-on-weight .item')).map(el => {
      const label = el.querySelector('span')?.textContent?.trim() ?? ''
      const pct = el.querySelector('.rating_per')?.textContent?.trim() ?? ''
      return { label, percentage: pct }
    })

    const recommendations = Array.from(document.querySelectorAll('.recommendations-bd dl')).map(el => {
      const name = el.querySelector('dd a')?.textContent?.trim() ?? ''
      const link = el.querySelector('dd a')?.getAttribute('href') ?? ''
      const idMatch = link.match(/\/subject\/(\d+)/)
      return { title: name, subjectId: idMatch?.[1] ?? '' }
    })

    const subjectIdMatch = window.location.pathname.match(/\/subject\/(\d+)/)
    return {
      subjectId: subjectIdMatch?.[1] ?? '',
      title, year, rating, ratingCount: Number(ratingCount) || 0,
      poster, summary,
      director, writer: writerMatch?.[1]?.trim() ?? '', actors, genre, runtime, releaseDate,
      country: countryMatch?.[1]?.trim() ?? '',
      language: langMatch?.[1]?.trim() ?? '',
      alias: aliasMatch?.[1]?.trim() ?? '',
      imdb: imdbMatch?.[1] ?? '',
      ratingDistribution: stars,
      recommendations,
    }
  })
}

async function getMovieReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  await navigateAndWait(page, `https://movie.douban.com/subject/${subjectId}/reviews`)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.review-item')).map(el => {
      const title = el.querySelector('h2 a')?.textContent?.trim() ?? ''
      const author = el.querySelector('.name')?.textContent?.trim() ?? ''
      const ratingEl = el.querySelector('[class*="rating"]')
      const rating = ratingEl?.getAttribute('title') ?? ratingEl?.className?.match(/allstar(\d+)/)?.[1] ?? ''
      const content = el.querySelector('.short-content')?.textContent?.trim() ?? ''
      const useful = el.querySelector('.action-btn')?.textContent?.trim() ?? ''
      const link = el.querySelector('h2 a')?.getAttribute('href') ?? ''
      return { title, author, rating, content, usefulCount: useful, url: link }
    })
    return { subjectId: window.location.pathname.match(/\/subject\/(\d+)/)?.[1] ?? '', reviews: items, totalReviews: items.length }
  })
}

async function getMoviePhotos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  const type = String(params.type ?? 'S')
  await navigateAndWait(page, `https://movie.douban.com/subject/${subjectId}/photos?type=${type}`)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.poster-col3 li')).map(el => {
      const img = el.querySelector('img')?.getAttribute('src') ?? ''
      const link = el.querySelector('a')?.getAttribute('href') ?? ''
      const info = el.querySelector('.name')?.textContent?.trim() ?? ''
      return { imageUrl: img, pageUrl: link, info }
    })
    return { subjectId: window.location.pathname.match(/\/subject\/(\d+)/)?.[1] ?? '', photos: items, totalPhotos: items.length }
  })
}

async function getTop250(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const start = Number(params.start ?? 0)
  await navigateAndWait(page, `https://movie.douban.com/top250?start=${start}`)

  return page.evaluate((startOffset) => {
    const items = Array.from(document.querySelectorAll('.item')).map(el => {
      const rank = el.querySelector('em')?.textContent?.trim() ?? ''
      const titleEl = el.querySelector('.title')
      const title = titleEl?.textContent?.trim() ?? ''
      const rating = el.querySelector('.rating_num')?.textContent?.trim() ?? ''
      const ratingCount = el.querySelector('.star span:last-child')?.textContent?.trim()?.replace(/[^\d]/g, '') ?? ''
      const quote = el.querySelector('.inq')?.textContent?.trim() ?? ''
      const link = el.querySelector('.hd a')?.getAttribute('href') ?? ''
      const idMatch = link.match(/\/subject\/(\d+)/)
      const info = el.querySelector('.bd p')?.textContent?.trim() ?? ''
      return {
        rank: Number(rank),
        subjectId: idMatch?.[1] ?? '',
        title, rating, ratingCount: Number(ratingCount) || 0, quote, info, url: link,
      }
    })
    return { movies: items, start: startOffset, pageSize: 25 }
  }, start)
}

async function searchBooks(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const url = `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(query)}&cat=1001`
  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.item-root')).map(el => {
      const titleEl = el.querySelector('.title a')
      const ratingEl = el.querySelector('.rating_nums')
      const metaEl = el.querySelector('.meta')
      const imgEl = el.querySelector('img')
      const href = titleEl?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)/)
      return {
        subjectId: idMatch?.[1] ?? '',
        title: titleEl?.textContent?.trim() ?? '',
        rating: ratingEl?.textContent?.trim() ?? '',
        meta: metaEl?.textContent?.trim() ?? '',
        url: href,
        coverImage: imgEl?.getAttribute('src') ?? '',
      }
    })
    return { results: items, totalResults: items.length }
  })
}

async function getBookDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  await navigateAndWait(page, `https://book.douban.com/subject/${subjectId}/`)

  return page.evaluate(() => {
    const title = document.querySelector('#wrapper h1 span')?.textContent?.trim() ?? ''
    const rating = document.querySelector('.rating_num')?.textContent?.trim() ?? ''
    const ratingCount = document.querySelector('.rating_people span')?.textContent?.trim() ?? ''
    const poster = document.querySelector('#mainpic img')?.getAttribute('src') ?? ''
    const summary = document.querySelector('.related_info .intro')?.textContent?.trim() ?? ''

    const infoEl = document.getElementById('info')
    const infoText = infoEl?.textContent ?? ''

    const author = Array.from(infoEl?.querySelectorAll('a[href*="/author/"], span a') ?? [])
      .filter(el => {
        const prev = el.parentElement?.previousElementSibling?.textContent ?? el.parentElement?.textContent ?? ''
        return prev.includes('作者')
      })
      .map(e => e.textContent?.trim() ?? '')

    const authorFallback = infoText.match(/作者:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const publisher = infoText.match(/出版社:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const pubDate = infoText.match(/出版年:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const pages = infoText.match(/页数:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const price = infoText.match(/定价:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const isbn = infoText.match(/ISBN:\s*(\d+)/)?.[1] ?? ''
    const binding = infoText.match(/装帧:\s*(.+?)\n/)?.[1]?.trim() ?? ''

    const subjectIdMatch = window.location.pathname.match(/\/subject\/(\d+)/)
    return {
      subjectId: subjectIdMatch?.[1] ?? '',
      title, rating, ratingCount: Number(ratingCount) || 0,
      poster, summary,
      author: author.length > 0 ? author : authorFallback.split('/').map(s => s.trim()),
      publisher, pubDate, pages, price, isbn, binding,
    }
  })
}

async function getBookReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  await navigateAndWait(page, `https://book.douban.com/subject/${subjectId}/reviews`)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.review-item')).map(el => {
      const title = el.querySelector('h2 a')?.textContent?.trim() ?? ''
      const author = el.querySelector('.name')?.textContent?.trim() ?? ''
      const ratingEl = el.querySelector('[class*="rating"]')
      const rating = ratingEl?.getAttribute('title') ?? ''
      const content = el.querySelector('.short-content')?.textContent?.trim() ?? ''
      const useful = el.querySelector('.action-btn')?.textContent?.trim() ?? ''
      const link = el.querySelector('h2 a')?.getAttribute('href') ?? ''
      return { title, author, rating, content, usefulCount: useful, url: link }
    })
    return { subjectId: window.location.pathname.match(/\/subject\/(\d+)/)?.[1] ?? '', reviews: items, totalReviews: items.length }
  })
}

async function searchMusic(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const url = `https://search.douban.com/music/subject_search?search_text=${encodeURIComponent(query)}&cat=1003`
  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.item-root')).map(el => {
      const titleEl = el.querySelector('.title a')
      const ratingEl = el.querySelector('.rating_nums')
      const metaEl = el.querySelector('.meta')
      const imgEl = el.querySelector('img')
      const href = titleEl?.getAttribute('href') ?? ''
      const idMatch = href.match(/\/subject\/(\d+)/)
      return {
        subjectId: idMatch?.[1] ?? '',
        title: titleEl?.textContent?.trim() ?? '',
        rating: ratingEl?.textContent?.trim() ?? '',
        meta: metaEl?.textContent?.trim() ?? '',
        url: href,
        coverImage: imgEl?.getAttribute('src') ?? '',
      }
    })
    return { results: items, totalResults: items.length }
  })
}

async function getMusicDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subjectId = String(params.subjectId ?? params.id ?? '')
  await navigateAndWait(page, `https://music.douban.com/subject/${subjectId}/`)

  return page.evaluate(() => {
    const title = document.querySelector('#wrapper h1 span')?.textContent?.trim() ?? ''
    const rating = document.querySelector('.rating_num')?.textContent?.trim() ?? ''
    const ratingCount = document.querySelector('.rating_people span')?.textContent?.trim() ?? ''
    const poster = document.querySelector('#mainpic img')?.getAttribute('src') ?? ''

    const infoEl = document.getElementById('info')
    const infoText = infoEl?.textContent ?? ''

    const artist = infoText.match(/表演者:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const genre = infoText.match(/流派:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const albumType = infoText.match(/专辑类型:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const medium = infoText.match(/介质:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const releaseDate = infoText.match(/发行时间:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const publisher = infoText.match(/出版者:\s*(.+?)\n/)?.[1]?.trim() ?? ''
    const alias = infoText.match(/又名:\s*(.+?)\n/)?.[1]?.trim() ?? ''

    const tracks = Array.from(document.querySelectorAll('.track-list li')).map(el => el.textContent?.trim() ?? '')

    const subjectIdMatch = window.location.pathname.match(/\/subject\/(\d+)/)
    return {
      subjectId: subjectIdMatch?.[1] ?? '',
      title, rating, ratingCount: Number(ratingCount) || 0,
      poster, artist, genre, albumType, medium, releaseDate, publisher, alias, tracks,
    }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchMovies,
  getMovieDetail,
  getMovieReviews,
  getMoviePhotos,
  getTop250,
  searchBooks,
  getBookDetail,
  getBookReviews,
  searchMusic,
  getMusicDetail,
}

const adapter: CodeAdapter = {
  name: 'douban-dom',
  description: 'Douban — movie/book/music search, details, reviews via DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('douban.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.douban.com')
    return cookies.some(c => c.name === 'dbcl2')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
