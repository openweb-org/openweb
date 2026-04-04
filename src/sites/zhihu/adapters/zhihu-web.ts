import type { Page } from 'patchright'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Zhihu L3 adapter — page-based API access with cookie session.
 *
 * Zhihu APIs require browser cookies for authentication. All endpoints are
 * called via page.evaluate(fetch(...)) which inherits the browser's session
 * cookies automatically.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const SITE_BASE = 'https://www.zhihu.com'

async function fetchApi(
  page: Page,
  apiPath: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return page.evaluate(
    async ({ path, qs, base }) => {
      const url = new URL(path, base)
      for (const [k, v] of Object.entries(qs)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
      const resp = await fetch(url.toString(), { credentials: 'include' })
      return resp.json()
    },
    { path: apiPath, qs: params, base: SITE_BASE },
  )
}

async function postApi(
  page: Page,
  apiPath: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  return page.evaluate(
    async ({ path, body, base }) => {
      const resp = await fetch(new URL(path, base).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (resp.status === 204) return { success: true }
      return resp.json()
    },
    { path: apiPath, body, base: SITE_BASE },
  )
}


/* ---------- read operation handlers ---------- */

async function searchContent(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw OpenWebError.missingParam('q')
  return fetchApi(page, '/api/v4/search_v3', {
    q,
    t: params.t ?? 'general',
    offset: params.offset ?? 0,
    limit: params.limit ?? 20,
    correction: params.correction ?? 1,
    search_source: 'Normal',
  })
}

async function getMember(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw OpenWebError.missingParam('url_token')
  const include = String(
    params.include ??
      'allow_message,is_followed,is_following,is_org,is_blocking,employments,answer_count,follower_count,articles_count,gender',
  )
  return fetchApi(page, `/api/v4/members/${encodeURIComponent(urlToken)}`, { include })
}

async function getUserAnswers(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw OpenWebError.missingParam('url_token')
  return fetchApi(page, `/api/v4/members/${encodeURIComponent(urlToken)}/answers`, {
    offset: params.offset ?? 0,
    limit: params.limit ?? 20,
    sort_by: params.sort_by ?? 'created',
    include:
      'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,collapsed_by,suggest_edit,comment_count,can_comment,content,voteup_count,reshipment_settings,comment_permission,mark_infos,created_time,updated_time,review_info,excerpt,is_labeled,label_info,relationship.is_authorized,voting,is_author,is_thanked,is_nothelp,is_recognized;data[*].author.badge[?(type=best_answerer)].topics;data[*].question.has_publishing_draft,relationship',
  })
}

async function getHotSearch(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchApi(page, '/api/v4/search/hot_search')
}


async function listSimilarQuestions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionId = params.question_id ?? params.id
  if (!questionId) throw OpenWebError.missingParam('id')
  return fetchApi(page, `/api/v4/questions/${questionId}/similar-questions`, {
    include: 'data[*].answer_count,author,follower_count',
    limit: params.limit ?? 5,
  })
}

async function getFeedRecommend(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return fetchApi(page, '/api/v3/feed/topstory/recommend', {
    limit: params.limit ?? 10,
    desktop: params.desktop ?? 'true',
  })
}

async function listMemberActivities(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw OpenWebError.missingParam('url_token')
  return fetchApi(page, `/api/v3/moments/${encodeURIComponent(urlToken)}/activities`, {
    limit: params.limit ?? 5,
    desktop: params.desktop ?? 'true',
  })
}


async function getMe(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchApi(page, '/api/v4/me', {
    include: 'is_realname,ad_type,available_message_types,default_notifications_count,follow_notifications_count,vote_thank_notifications_count,moments_count,badge',
  })
}

async function getEntityWord(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return fetchApi(page, '/api/v3/entity_word', {
    token: params.token,
    type: params.type ?? 'answer',
  })
}

async function listMemberMutuals(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw OpenWebError.missingParam('url_token')
  return fetchApi(page, `/api/v4/members/${encodeURIComponent(urlToken)}/relations/mutuals`, {
    offset: params.offset ?? 0,
    limit: params.limit ?? 20,
  })
}

async function listQuestionFollowers(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionId = params.question_id ?? params.id
  if (!questionId) throw OpenWebError.missingParam('id')
  return fetchApi(page, `/api/v4/questions/${questionId}/concerned_followers`, {
    offset: params.offset ?? 0,
    limit: params.limit ?? 20,
  })
}

/* ---------- write operation handlers ---------- */

async function upvoteAnswer(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const answerId = String(params.answer_id ?? '')
  if (!answerId) throw OpenWebError.missingParam('answer_id')
  const type = String(params.type ?? 'up')
  return postApi(page, `/api/v4/answers/${encodeURIComponent(answerId)}/voters`, { type })
}

async function followUser(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw OpenWebError.missingParam('url_token')
  return postApi(page, `/api/v4/members/${encodeURIComponent(urlToken)}/followers`)
}

async function followQuestion(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionId = String(params.question_id ?? '')
  if (!questionId) throw OpenWebError.missingParam('question_id')
  return postApi(page, `/api/v4/questions/${encodeURIComponent(questionId)}/followers`)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchContent,
  getMember,
  getUserAnswers,
  getHotSearch,
  listSimilarQuestions,
  getFeedRecommend,
  listMemberActivities,
  getMe,
  getEntityWord,
  listMemberMutuals,
  listQuestionFollowers,
  upvoteAnswer,
  followUser,
  followQuestion,
}

const adapter: CodeAdapter = {
  name: 'zhihu-web',
  description: 'Zhihu (知乎) — Q&A search, user profiles, topics, trending via page API fetch',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('zhihu.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.zhihu.com')
    return cookies.some((c) => c.name === 'z_c0')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
