import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://m.douban.com'
const REFERER = 'https://m.douban.com/'

type Params = Readonly<Record<string, unknown>>
type Obj = Record<string, unknown>

function str(v: unknown): string { return v == null ? '' : String(v) }
function int(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

async function get(path: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${API}${path}`
  const { status, text } = await nodeFetch({
    url, method: 'GET',
    headers: { Accept: 'application/json', Referer: REFERER },
    timeout: 20_000,
  })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(base: string, params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `${base}?${parts.join('&')}` : base
}

// ── Trim helpers ──

function trimRating(r: Obj | undefined | null): Obj | null {
  if (!r) return null
  return { count: r.count, max: r.max, value: r.value, star_count: r.star_count }
}

function trimRatingCompact(r: Obj | undefined | null): Obj | null {
  if (!r) return null
  return { count: r.count, value: r.value }
}

function trimSearchTarget(t: Obj): Obj {
  return {
    id: t.id, title: t.title,
    rating: trimRatingCompact(t.rating as Obj),
    cover_url: t.cover_url, card_subtitle: t.card_subtitle,
    abstract: t.abstract, null_rating_reason: t.null_rating_reason,
  }
}

function trimReview(r: Obj): Obj {
  const user = r.user as Obj | undefined
  return {
    id: r.id, comment: r.comment,
    rating: trimRating(r.rating as Obj),
    create_time: r.create_time, vote_count: r.vote_count,
    user: user ? { name: user.name, uid: user.uid, avatar: user.avatar } : undefined,
    status: r.status, ip_location: r.ip_location,
  }
}

function trimCelebrity(c: Obj): Obj {
  const avatar = c.avatar as Obj | undefined
  return {
    id: c.id, name: c.name, latin_name: c.latin_name,
    character: c.character, roles: c.roles,
    avatar: avatar ? { large: avatar.large } : undefined,
  }
}

function trimPhoto(p: Obj): Obj {
  const image = p.image as Obj | undefined
  const large = image?.large as Obj | undefined
  const normal = image?.normal as Obj | undefined
  return {
    id: p.id,
    image: {
      large: large ? { url: large.url, width: large.width, height: large.height } : undefined,
      normal: normal ? { url: normal.url, width: normal.width, height: normal.height } : undefined,
    },
    description: p.description, create_time: p.create_time,
    comments_count: p.comments_count, likers_count: p.likers_count,
  }
}

// ── Operations ──

async function searchMovies(params: Params, errors: AdapterErrorHelpers) {
  const q = str(params.q)
  if (!q) throw errors.missingParam('q')
  const url = qs(`${API}/rexxar/api/v2/search/movie`, {
    q, count: int(params.count as number, 20), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const items = ((raw.items ?? []) as Obj[]).map(item => ({
    target_id: item.target_id,
    target: trimSearchTarget((item.target ?? {}) as Obj),
    target_type: item.target_type,
  }))
  return { count: raw.count, start: raw.start, total: raw.total, items }
}

async function getMovie(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const raw = await get(`${API}/rexxar/api/v2/movie/${id}`, errors) as Obj
  const directors = ((raw.directors ?? []) as Obj[]).map(d => ({ name: d.name }))
  const actors = ((raw.actors ?? []) as Obj[]).map(a => ({ name: a.name }))
  const pic = raw.pic as Obj | undefined
  const trailers = ((raw.trailers ?? []) as Obj[]).map(t => ({
    title: t.title, video_url: t.video_url, cover_url: t.cover_url,
  }))
  return {
    id: raw.id, title: raw.title, original_title: raw.original_title,
    year: raw.year, rating: trimRating(raw.rating as Obj),
    genres: raw.genres, countries: raw.countries, languages: raw.languages,
    durations: raw.durations, pubdate: raw.pubdate,
    intro: raw.intro, cover_url: raw.cover_url,
    pic: pic ? { large: pic.large, normal: pic.normal } : undefined,
    directors, actors, aka: raw.aka,
    is_tv: raw.is_tv, review_count: raw.review_count,
    comment_count: raw.comment_count,
    ...(trailers.length > 0 ? { trailers } : {}),
  }
}

async function getMovieReviews(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const url = qs(`${API}/rexxar/api/v2/movie/${id}/interests`, {
    count: int(params.count as number, 10), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const interests = ((raw.interests ?? []) as Obj[]).map(trimReview)
  return { count: raw.count, start: raw.start, total: raw.total, interests }
}

async function getMovieCelebrities(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const raw = await get(`${API}/rexxar/api/v2/movie/${id}/celebrities`, errors) as Obj
  return {
    total: raw.total,
    directors: ((raw.directors ?? []) as Obj[]).map(trimCelebrity),
    actors: ((raw.actors ?? []) as Obj[]).map(trimCelebrity),
  }
}

async function getMoviePhotos(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const url = qs(`${API}/rexxar/api/v2/movie/${id}/photos`, {
    count: int(params.count as number, 20), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  return {
    count: raw.count, start: raw.start, total: raw.total,
    photos: ((raw.photos ?? []) as Obj[]).map(trimPhoto),
  }
}

async function getTop250(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/rexxar/api/v2/subject_collection/movie_top250/items`, {
    start: int(params.start as number, 0), count: int(params.count as number, 25),
  })
  const raw = await get(url, errors) as Obj
  const collection = raw.subject_collection as Obj | undefined
  const items = ((raw.subject_collection_items ?? []) as Obj[]).map(item => ({
    id: item.id, title: item.title, rank: item.rank, rank_value: item.rank_value,
    rating: trimRatingCompact(item.rating as Obj),
    cover_url: item.cover_url, card_subtitle: item.card_subtitle,
    description: item.description, type: item.type,
  }))
  return {
    count: raw.count, start: raw.start, total: raw.total,
    subject_collection: collection ? { id: collection.id, name: collection.name } : undefined,
    subject_collection_items: items,
  }
}

async function searchBooks(params: Params, errors: AdapterErrorHelpers) {
  const q = str(params.q)
  if (!q) throw errors.missingParam('q')
  const url = qs(`${API}/rexxar/api/v2/search/book`, {
    q, count: int(params.count as number, 20), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const items = ((raw.items ?? []) as Obj[]).map(item => ({
    target_id: item.target_id,
    target: trimSearchTarget((item.target ?? {}) as Obj),
    target_type: item.target_type,
  }))
  return { count: raw.count, start: raw.start, total: raw.total, items }
}

async function getBook(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const raw = await get(`${API}/rexxar/api/v2/book/${id}`, errors) as Obj
  const pic = raw.pic as Obj | undefined
  return {
    id: raw.id, title: raw.title,
    rating: trimRating(raw.rating as Obj),
    subtitle: raw.subtitle, pubdate: raw.pubdate,
    pic: pic ? { large: pic.large, normal: pic.normal } : undefined,
    intro: raw.intro, author_intro: raw.author_intro,
    card_subtitle: raw.card_subtitle, review_count: raw.review_count,
  }
}

async function getBookReviews(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const url = qs(`${API}/rexxar/api/v2/book/${id}/interests`, {
    count: int(params.count as number, 10), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const interests = ((raw.interests ?? []) as Obj[]).map(trimReview)
  return { count: raw.count, start: raw.start, total: raw.total, interests }
}

async function searchMusic(params: Params, errors: AdapterErrorHelpers) {
  const q = str(params.q)
  if (!q) throw errors.missingParam('q')
  const url = qs(`${API}/rexxar/api/v2/search/music`, {
    q, count: int(params.count as number, 20), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const items = ((raw.items ?? []) as Obj[]).map(item => ({
    target_id: item.target_id,
    target: trimSearchTarget((item.target ?? {}) as Obj),
    target_type: item.target_type,
  }))
  return { count: raw.count, start: raw.start, total: raw.total, items }
}

async function getMusicDetail(params: Params, errors: AdapterErrorHelpers) {
  const id = params.id
  if (id == null) throw errors.missingParam('id')
  const raw = await get(`${API}/rexxar/api/v2/music/${id}`, errors) as Obj
  const pic = raw.pic as Obj | undefined
  const singer = ((raw.singer ?? []) as Obj[]).map(s => ({ name: s.name }))
  const songs = ((raw.songs ?? []) as Obj[]).map(s => ({ title: s.title }))
  return {
    id: raw.id, title: raw.title,
    rating: trimRating(raw.rating as Obj),
    singer, genres: raw.genres, pubdate: raw.pubdate,
    publisher: raw.publisher, media: raw.media,
    songs, intro: raw.intro, cover_url: raw.cover_url,
    pic: pic ? { large: pic.large, normal: pic.normal } : undefined,
    card_subtitle: raw.card_subtitle,
    review_count: raw.review_count, comment_count: raw.comment_count,
  }
}

async function getRecentHotMovies(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/rexxar/api/v2/subject/recent_hot/movie`, {
    limit: int(params.limit as number, 50),
  })
  const raw = await get(url, errors) as Obj
  const items = ((raw.items ?? []) as Obj[]).map(item => ({
    id: item.id, title: item.title,
    rating: trimRatingCompact(item.rating as Obj),
    pic: (item.pic as Obj)?.large ? { large: (item.pic as Obj).large } : undefined,
    card_subtitle: item.card_subtitle, is_new: item.is_new, type: item.type,
  }))
  return { category: raw.category, total: raw.total, type: raw.type, items }
}

async function getRecentHotTv(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/rexxar/api/v2/subject/recent_hot/tv`, {
    limit: int(params.limit as number, 50),
  })
  const raw = await get(url, errors) as Obj
  const items = ((raw.items ?? []) as Obj[]).map(item => ({
    id: item.id, title: item.title,
    rating: trimRatingCompact(item.rating as Obj),
    pic: (item.pic as Obj)?.large ? { large: (item.pic as Obj).large } : undefined,
    card_subtitle: item.card_subtitle, episodes_info: item.episodes_info,
    is_new: item.is_new, type: item.type,
  }))
  return { category: raw.category, total: raw.total, type: raw.type, items }
}

async function getNowShowingMovies(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/rexxar/api/v2/subject_collection/movie_showing/items`, {
    count: int(params.count as number, 20), start: int(params.start as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const collection = raw.subject_collection as Obj | undefined
  const items = ((raw.subject_collection_items ?? []) as Obj[]).map(item => {
    const cover = item.cover as Obj | undefined
    return {
      id: item.id, title: item.title, year: item.year,
      rating: trimRatingCompact(item.rating as Obj),
      cover: cover ? { url: cover.url } : undefined,
      card_subtitle: item.card_subtitle, release_date: item.release_date,
      directors: item.directors, actors: item.actors, type: item.type,
      null_rating_reason: item.null_rating_reason,
    }
  })
  return {
    count: raw.count, start: raw.start, total: raw.total,
    subject_collection: collection ? { id: collection.id, name: collection.name } : undefined,
    subject_collection_items: items,
  }
}

const adapter: CustomRunner = {
  name: 'douban-read',
  description: 'Douban — all read operations with response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx

    switch (operation) {
      case 'searchMovies': return searchMovies(params, helpers.errors)
      case 'getMovie': return getMovie(params, helpers.errors)
      case 'getMovieReviews': return getMovieReviews(params, helpers.errors)
      case 'getMovieCelebrities': return getMovieCelebrities(params, helpers.errors)
      case 'getMoviePhotos': return getMoviePhotos(params, helpers.errors)
      case 'getTop250': return getTop250(params, helpers.errors)
      case 'searchBooks': return searchBooks(params, helpers.errors)
      case 'getBook': return getBook(params, helpers.errors)
      case 'getBookReviews': return getBookReviews(params, helpers.errors)
      case 'searchMusic': return searchMusic(params, helpers.errors)
      case 'getMusicDetail': return getMusicDetail(params, helpers.errors)
      case 'getRecentHotMovies': return getRecentHotMovies(params, helpers.errors)
      case 'getRecentHotTv': return getRecentHotTv(params, helpers.errors)
      case 'getNowShowingMovies': return getNowShowingMovies(params, helpers.errors)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
