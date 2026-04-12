import type { Page } from 'patchright'

type AdapterErrors = { botBlocked(msg: string): Error; unknownOp(op: string): Error; missingParam(name: string): Error; wrap(error: unknown): Error }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

async function fetchHtml(url: string, errors: AdapterErrors): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } })
  if (!res.ok) throw errors.wrap(new Error(`HTTP ${res.status} for ${url}`))
  const html = await res.text()
  if (html.includes('challenge-platform') || html.includes('cf-challenge')) {
    throw errors.botBlocked('Cloudflare challenge')
  }
  return html
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Parse __NEXT_DATA__ from book page HTML. Returns apolloState map. */
function parseNextData(html: string): Record<string, any> | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    const nd = JSON.parse(m[1])
    return nd.props?.pageProps?.apolloState ?? null
  } catch { return null }
}

/** Resolve a { __ref: "Key" } pointer in Apollo state. */
function resolve(state: Record<string, any>, ref: any): any {
  if (ref?.__ref) return state[ref.__ref] ?? null
  return ref
}

// ── searchBooks ─────────────────────────────────────────────────────

async function searchBooks(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const q = params.q as string
  if (!q) throw errors.missingParam('q')
  const page = params.page ? Number(params.page) : 1
  const html = await fetchHtml(`https://www.goodreads.com/search?q=${encodeURIComponent(q)}&page=${page}`, errors)

  const items: Record<string, unknown>[] = []
  const rowRe = /<tr[^>]*itemtype="http:\/\/schema\.org\/Book"[\s\S]*?<\/tr>/g
  let rm: RegExpExecArray | null
  for (rm = rowRe.exec(html); rm !== null; rm = rowRe.exec(html)) {
    const row = rm[0]
    const titleMatch = row.match(/<a class="bookTitle"[^>]*href="([^"]*)"[\s\S]*?itemprop=["']name["'][^>]*>([^<]*)</)
    const bookUrl = titleMatch?.[1] ?? ''
    const title = titleMatch ? unescapeHtml(titleMatch[2].trim()) : ''
    const bookId = bookUrl.match(/\/book\/show\/(\d+)/)?.[1] ?? ''
    const authorMatch = row.match(/<a class="authorName"[^>]*href="([^"]*)"[^>]*>[\s\S]*?itemprop=["']name["'][^>]*>([^<]*)</)
    const authorUrl = authorMatch?.[1] ?? ''
    const author = authorMatch ? unescapeHtml(authorMatch[2].trim()) : ''
    const authorId = authorUrl.match(/\/author\/show\/(\d+)/)?.[1] ?? ''
    const miniratingRaw = row.match(/class="minirating">([\s\S]*?ratings[\s\S]*?)<\/span>/)?.[1] ?? ''
    const ratingText = miniratingRaw.replace(/<[^>]+>/g, '') // strip inner star spans
    const ratingMatch = ratingText.match(/([\d.]+)\s*avg rating/)
    const ratingsMatch = ratingText.match(/([\d,]+)\s*rating/)
    const coverImg = row.match(/<img[^>]*class="bookCover"[^>]*src="([^"]*)"/)?.[1] ?? null

    items.push({
      bookId,
      title,
      author,
      authorId,
      averageRating: ratingMatch ? Number.parseFloat(ratingMatch[1]) : null,
      ratingsCount: ratingsMatch ? Number.parseInt(ratingsMatch[1].replace(/,/g, ''), 10) : null,
      coverImageUrl: coverImg,
    })
  }

  return { resultCount: items.length, items }
}

// ── getBook ─────────────────────────────────────────────────────────

async function getBook(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const bookId = String(params.bookId ?? '')
  if (!bookId) throw errors.missingParam('bookId')
  const html = await fetchHtml(`https://www.goodreads.com/book/show/${encodeURIComponent(bookId)}`, errors)

  const state = parseNextData(html)
  if (!state) throw errors.wrap(new Error('No __NEXT_DATA__ found on book page'))

  const keys = Object.keys(state)
  const bookKey = keys.find(k => k.startsWith('Book:'))
  const workKey = keys.find(k => k.startsWith('Work:'))
  const bookEntry = bookKey ? state[bookKey] : undefined
  const workEntry = workKey ? state[workKey] : undefined
  if (!bookEntry) throw errors.wrap(new Error('No Book entry in Apollo state'))

  const contributor = resolve(state, bookEntry.primaryContributorEdge?.node)
  const series = bookEntry.bookSeries?.[0]
    ? resolve(state, bookEntry.bookSeries[0].series)
    : null
  const seriesPos = bookEntry.bookSeries?.[0]?.userPosition ?? null

  const genres = (bookEntry.bookGenres ?? [])
    .map((g: any) => g?.genre?.name)
    .filter(Boolean) as string[]

  const stats = workEntry?.stats
  const awards = (workEntry?.details?.awardsWon ?? [])
    .map((a: any) => `${a.name} — ${a.category} (${a.designation})`)

  const pubTime = bookEntry.details?.publicationTime
  const publishDate = pubTime ? new Date(pubTime).toISOString().split('T')[0] : null
  const origPubTime = workEntry?.details?.publicationTime
  const firstPublished = origPubTime && origPubTime !== pubTime
    ? new Date(origPubTime).toISOString().split('T')[0]
    : null

  return {
    title: bookEntry.titleComplete ?? bookEntry.title ?? '',
    series: series ? `${series.title}${seriesPos ? ` #${seriesPos}` : ''}` : null,
    author: contributor?.name ?? '',
    authorId: contributor?.legacyId ? String(contributor.legacyId) : '',
    ratingValue: stats?.averageRating ?? null,
    ratingsCount: stats?.ratingsCount ?? null,
    reviewsCount: stats?.textReviewsCount ?? null,
    description: bookEntry['description({"stripped":true})']
      ?? (stripHtml(bookEntry.description ?? '') || null),
    genres,
    pageCount: bookEntry.details?.numPages ?? null,
    format: bookEntry.details?.format ?? null,
    publishDate: firstPublished
      ? `First published ${firstPublished}`
      : publishDate,
    isbn: bookEntry.details?.isbn13 ?? bookEntry.details?.isbn ?? null,
    language: bookEntry.details?.language?.name ?? null,
    awards: awards.length ? awards.join(', ') : null,
    coverImageUrl: bookEntry.imageUrl ?? null,
  }
}

// ── getReviews ──────────────────────────────────────────────────────

async function getReviews(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const bookId = String(params.bookId ?? '')
  if (!bookId) throw errors.missingParam('bookId')
  const html = await fetchHtml(`https://www.goodreads.com/book/show/${encodeURIComponent(bookId)}`, errors)

  const state = parseNextData(html)
  if (!state) throw errors.wrap(new Error('No __NEXT_DATA__ found on book page'))

  const keys = Object.keys(state)
  const reviewKeys = keys.filter(k => k.startsWith('Review:'))

  const reviews = reviewKeys.map(k => {
    const r = state[k]
    const user = resolve(state, r.creator)
    const text = r.text ? stripHtml(r.text) : ''
    const createdAt = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null
    return {
      name: user?.name ?? '',
      rating: r.rating ?? null,
      text: text.substring(0, 2000),
      date: createdAt,
      likes: r.likeCount ?? null,
    }
  })

  return { totalReviews: reviews.length, reviews }
}

// ── getAuthor ───────────────────────────────────────────────────────

async function getAuthor(_page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const authorId = String(params.authorId ?? '')
  if (!authorId) throw errors.missingParam('authorId')
  const html = await fetchHtml(`https://www.goodreads.com/author/show/${encodeURIComponent(authorId)}`, errors)

  const nameMatch = html.match(/<h1 class="authorName">\s*<span itemprop="name">([^<]+)<\/span>/)
  const name = nameMatch ? unescapeHtml(nameMatch[1].trim()) : ''

  const imgMatch = html.match(/class="[^"]*authorLeftContainer"[\s\S]*?<img[^>]*src="([^"]*)"/)
  const image = imgMatch?.[1] ?? null

  // Bio from aboutAuthorInfo freeText
  let bio: string | null = null
  const bioStart = html.indexOf('class="aboutAuthorInfo"')
  if (bioStart !== -1) {
    const freeTextMatch = html.substring(bioStart, bioStart + 5000).match(/id="[^"]*freeText[^"]*"[^>]*>([\s\S]*?)<\/span>/)
    if (freeTextMatch) bio = stripHtml(freeTextMatch[1]) || null
  }

  const bornMatch = html.match(/itemprop=['"]birthDate['"][^>]*>([\s\S]*?)</)
  const born = bornMatch ? unescapeHtml(bornMatch[1].trim()) : null
  const diedMatch = html.match(/itemprop=['"]deathDate['"][^>]*>([\s\S]*?)</)
  const died = diedMatch ? unescapeHtml(diedMatch[1].trim()) : null

  const websiteMatch = html.match(/<a[^>]*itemprop="url"[^>]*href="([^"]*)"/)
  const website = websiteMatch?.[1] ?? null

  // Genres
  const genres: string[] = []
  const genreRe = /href="[^"]*\/genres\/[^"]*">([^<]+)/g
  let gm: RegExpExecArray | null
  for (gm = genreRe.exec(html); gm !== null; gm = genreRe.exec(html)) {
    const g = unescapeHtml(gm[1].trim())
    if (g && !genres.includes(g)) genres.push(g)
  }

  // Average rating
  const ratingMatch = html.match(/itemprop=['"]ratingValue['"][^>]*>([\d.]+)/)
  const ratingValue = ratingMatch ? Number.parseFloat(ratingMatch[1]) : null

  // Books from bibliography
  const books: Record<string, unknown>[] = []
  const bookRowRe = /<tr[^>]*itemtype="http:\/\/schema\.org\/Book"[\s\S]*?<\/tr>/g
  let bm: RegExpExecArray | null
  for (bm = bookRowRe.exec(html); bm !== null; bm = bookRowRe.exec(html)) {
    const row = bm[0]
    const titleMatch = row.match(/class="bookTitle"[^>]*href="([^"]*)"[\s\S]*?itemprop=["']name["'][^>]*>([^<]*)/)
    const bUrl = titleMatch?.[1] ?? ''
    const bTitle = titleMatch ? unescapeHtml(titleMatch[2].trim()) : ''
    const bId = bUrl.match(/\/book\/show\/(\d+)/)?.[1] ?? ''
    const miniratingRaw2 = row.match(/class="minirating">([\s\S]*?ratings[\s\S]*?)<\/span>/)?.[1] ?? ''
    const ratingText2 = miniratingRaw2.replace(/<[^>]+>/g, '')
    const rm2 = ratingText2.match(/([\d.]+)\s*avg rating/)
    const rc2 = ratingText2.match(/([\d,]+)\s*rating/)
    books.push({
      bookId: bId,
      title: bTitle,
      averageRating: rm2 ? Number.parseFloat(rm2[1]) : null,
      ratingsCount: rc2 ? Number.parseInt(rc2[1].replace(/,/g, ''), 10) : null,
    })
  }

  return { name, image, bio, born, died, website, genres, ratingValue, booksCount: books.length, books }
}

// ── Adapter ─────────────────────────────────────────────────────────

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>> = {
  searchBooks,
  getBook,
  getReviews,
  getAuthor,
}

const adapter = {
  name: 'goodreads',
  description: 'Goodreads — node fetch + HTML/SSR parse, zero browser dependency',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('goodreads.com') || page.url() === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Record<string, unknown>): Promise<unknown> {
    const { errors } = helpers as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
