import { nodeFetch } from '../../../lib/adapter-helpers.js'
import { formatCookieString } from '../../../lib/cookies.js'
import { readTokenCache } from '../../../runtime/token-cache.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const API = 'https://www.zhihu.com'

type Params = Readonly<Record<string, unknown>>
type Obj = Record<string, unknown>

function str(v: unknown): string { return v == null ? '' : String(v) }
function int(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

async function authHeaders(): Promise<Record<string, string>> {
  const cached = await readTokenCache('zhihu').catch(() => null)
  if (!cached || cached.cookies.length === 0) return {}
  const cookieStr = formatCookieString(cached.cookies)
  return cookieStr ? { Cookie: cookieStr } : {}
}

async function get(url: string, errors: AdapterErrorHelpers): Promise<unknown> {
  const auth = await authHeaders()
  const { status, text } = await nodeFetch({
    url, method: 'GET',
    headers: { Accept: 'application/json', ...auth },
    timeout: 20_000,
  })
  if (status === 401 || status === 403) throw errors.needsLogin()
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

function trimAuthor(a: Obj | undefined): Obj | undefined {
  if (!a) return undefined
  return {
    id: a.id, url_token: a.url_token, name: a.name,
    headline: a.headline, avatar_url: a.avatar_url,
  }
}

function trimQuestion(q: Obj | undefined): Obj | undefined {
  if (!q) return undefined
  return {
    id: q.id, title: q.title ?? q.name, url: q.url, type: q.type,
    answer_count: q.answer_count, follower_count: q.follower_count ?? q.follow_count,
  }
}

function trimPaging(p: Obj | undefined): Obj | undefined {
  if (!p) return undefined
  return { is_end: p.is_end, next: p.next, totals: p.totals }
}

// ── Operation handlers ──

async function searchContent(params: Params, errors: AdapterErrorHelpers) {
  const q = str(params.q)
  if (!q) throw errors.missingParam('q')
  const url = qs(`${API}/api/v4/search_v3`, {
    q, t: str(params.t) || 'general',
    limit: int(params.limit as number, 20),
    offset: int(params.offset as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const data = (raw.data as Obj[] ?? [])
    .filter((item: Obj) => item.type === 'search_result')
    .map((item: Obj) => {
      const obj = (item.object ?? {}) as Obj
      return {
        type: item.type,
        highlight: item.highlight,
        object: {
          id: obj.id, type: obj.type, title: obj.title,
          url: obj.url, excerpt: obj.excerpt,
          voteup_count: obj.voteup_count, comment_count: obj.comment_count,
          zfav_count: obj.zfav_count,
          created_time: obj.created_time, updated_time: obj.updated_time,
          thumbnail_info: obj.thumbnail_info,
          author: trimAuthor(obj.author as Obj),
          question: trimQuestion(obj.question as Obj),
        },
      }
    })
  return { paging: trimPaging(raw.paging as Obj), data }
}

async function getFeedRecommend(params: Params, errors: AdapterErrorHelpers) {
  const url = qs(`${API}/api/v3/feed/topstory/recommend`, {
    action: str(params.action) || undefined,
    after_id: params.after_id != null ? int(params.after_id as number, 0) : undefined,
    desktop: str(params.desktop) || 'true',
    end_offset: params.end_offset != null ? int(params.end_offset as number, 0) : undefined,
    page_number: params.page_number != null ? int(params.page_number as number, 1) : undefined,
  })
  const raw = await get(url, errors) as Obj
  const data = ((raw.data ?? []) as Obj[]).map((item: Obj) => {
    const target = (item.target ?? {}) as Obj
    return {
      id: item.id, type: item.type, verb: item.verb,
      created_time: item.created_time,
      target: {
        id: target.id, type: target.type, url: target.url,
        excerpt: target.excerpt, voteup_count: target.voteup_count,
        comment_count: target.comment_count, favorite_count: target.favorite_count,
        thanks_count: target.thanks_count,
        created_time: target.created_time, updated_time: target.updated_time,
        author: trimAuthor(target.author as Obj),
        question: trimQuestion(target.question as Obj),
      },
    }
  })
  return { paging: trimPaging(raw.paging as Obj), data }
}

async function listMemberActivities(params: Params, errors: AdapterErrorHelpers) {
  const token = str(params.url_token)
  if (!token) throw errors.missingParam('url_token')
  const url = qs(`${API}/api/v3/moments/${encodeURIComponent(token)}/activities`, {
    desktop: str(params.desktop) || 'true',
    limit: int(params.limit as number, 5),
    offset: params.offset != null ? int(params.offset as number, 0) : undefined,
    page_num: params.page_num != null ? int(params.page_num as number, 1) : undefined,
  })
  const raw = await get(url, errors) as Obj
  const data = ((raw.data ?? []) as Obj[]).map((item: Obj) => {
    const target = (item.target ?? {}) as Obj
    return {
      id: item.id, type: item.type, verb: item.verb,
      created_time: item.created_time, action_text: item.action_text,
      target: {
        id: target.id, type: target.type, title: target.title,
        url: target.url, excerpt: target.excerpt,
        voteup_count: target.voteup_count, comment_count: target.comment_count,
        created_time: target.created_time, updated_time: target.updated_time,
        author: trimAuthor(target.author as Obj),
        question: trimQuestion(target.question as Obj),
      },
    }
  })
  return { paging: trimPaging(raw.paging as Obj), data }
}

async function getUserAnswers(params: Params, errors: AdapterErrorHelpers) {
  const token = str(params.url_token)
  if (!token) throw errors.missingParam('url_token')
  const include = str(params.include) || 'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,collapsed_by,suggest_edit,comment_count,can_comment,content,voteup_count,reshipment_settings,comment_permission,mark_infos,created_time,updated_time,review_info,excerpt,is_labeled,label_info,relationship.is_authorized,voting,is_author,is_thanked,is_nothelp,is_recognized;data[*].author.badge[?(type=best_answerer)].topics;data[*].question.has_publishing_draft,relationship'
  const url = qs(`${API}/api/v4/members/${encodeURIComponent(token)}/answers`, {
    include,
    sort_by: str(params.sort_by) || 'created',
    limit: int(params.limit as number, 20),
    offset: int(params.offset as number, 0),
  })
  const raw = await get(url, errors) as Obj
  const data = ((raw.data ?? []) as Obj[]).map((item: Obj) => ({
    id: item.id, type: item.type, url: item.url,
    excerpt: item.excerpt, voteup_count: item.voteup_count,
    comment_count: item.comment_count,
    created_time: item.created_time, updated_time: item.updated_time,
    author: trimAuthor(item.author as Obj),
    question: trimQuestion(item.question as Obj),
  }))
  return {
    paging: trimPaging(raw.paging as Obj),
    data,
  }
}

const MEMBER_INCLUDE = 'allow_message,is_followed,is_following,is_org,is_blocking,employments,answer_count,follower_count,articles_count,gender,badge[?(type=best_answerer)].topics'

async function getMember(params: Params, errors: AdapterErrorHelpers) {
  const token = str(params.url_token)
  if (!token) throw errors.missingParam('url_token')
  const include = str(params.include) || MEMBER_INCLUDE
  const url = qs(`${API}/api/v4/members/${encodeURIComponent(token)}`, { include })
  const raw = await get(url, errors) as Obj
  return {
    id: raw.id, url_token: raw.url_token, name: raw.name,
    avatar_url: raw.avatar_url, headline: raw.headline, gender: raw.gender,
    is_org: raw.is_org, type: raw.type, url: raw.url, user_type: raw.user_type,
    follower_count: raw.follower_count, answer_count: raw.answer_count,
    articles_count: raw.articles_count, employments: raw.employments,
    badge: raw.badge, allow_message: raw.allow_message,
    is_following: raw.is_following, is_followed: raw.is_followed,
    is_blocking: raw.is_blocking,
  }
}

async function getMe(_params: Params, errors: AdapterErrorHelpers) {
  const raw = await get(`${API}/api/v4/me`, errors) as Obj
  return {
    id: raw.id, url_token: raw.url_token, name: raw.name,
    avatar_url: raw.avatar_url, headline: raw.headline, gender: raw.gender,
    is_org: raw.is_org, type: raw.type, url: raw.url,
    answer_count: raw.answer_count, question_count: raw.question_count,
    articles_count: raw.articles_count, favorite_count: raw.favorite_count,
    voteup_count: raw.voteup_count, thanked_count: raw.thanked_count,
    default_notifications_count: raw.default_notifications_count,
    follow_notifications_count: raw.follow_notifications_count,
    vote_thank_notifications_count: raw.vote_thank_notifications_count,
    messages_count: raw.messages_count,
  }
}

async function getHotSearch(_params: Params, errors: AdapterErrorHelpers) {
  const raw = await get(`${API}/api/v4/search/hot_search`, errors) as Obj
  const items = ((raw.hot_search_queries ?? []) as Obj[]).map((item: Obj) => ({
    query: item.query, real_query: item.real_query,
    hot_show: item.hot_show, label: item.label, index: item.index,
  }))
  return { hot_search_queries: items }
}

const adapter: CustomRunner = {
  name: 'zhihu-read',
  description: 'Zhihu — read operations with response trimming',

  async run(ctx) {
    const { operation, params, helpers } = ctx

    switch (operation) {
      case 'searchContent': return searchContent(params, helpers.errors)
      case 'getFeedRecommend': return getFeedRecommend(params, helpers.errors)
      case 'listMemberActivities': return listMemberActivities(params, helpers.errors)
      case 'getUserAnswers': return getUserAnswers(params, helpers.errors)
      case 'getMember': return getMember(params, helpers.errors)
      case 'getMe': return getMe(params, helpers.errors)
      case 'getHotSearch': return getHotSearch(params, helpers.errors)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
