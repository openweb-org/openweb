/**
 * Zhihu L3 adapter — page-based API access with cookie session.
 *
 * Zhihu APIs require browser cookies for authentication. All endpoints are
 * called via page.evaluate(fetch(...)) which inherits the browser's session
 * cookies automatically.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

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

function resolvePath(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key]
    if (val === undefined || val === null) throw new Error(`Missing path param: ${key}`)
    return encodeURIComponent(String(val))
  })
}

/* ---------- operation handlers ---------- */

async function searchContent(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw new Error('q is required')
  return fetchApi(page, '/api/v4/search_v3', {
    q,
    t: params.t ?? 'general',
    offset: params.offset ?? 0,
    limit: params.limit ?? 20,
    correction: params.correction ?? 1,
    search_source: 'Normal',
  })
}

async function getUserProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw new Error('url_token is required')
  const include = String(
    params.include ??
      'allow_message,is_followed,is_following,is_org,is_blocking,employments,answer_count,follower_count,articles_count,gender',
  )
  return fetchApi(page, `/api/v4/members/${encodeURIComponent(urlToken)}`, { include })
}

async function getUserAnswers(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw new Error('url_token is required')
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

async function getTopicIntro(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const topicId = params.topic_id
  if (!topicId) throw new Error('topic_id is required')
  return fetchApi(page, `/api/v4/topics/${topicId}/intro`, {
    include: params.include ?? 'content.meta.content.photos',
  })
}

async function getTopicFeed(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const topicId = params.topic_id
  if (!topicId) throw new Error('topic_id is required')
  return fetchApi(page, `/api/v5.1/topics/${topicId}/feeds/essence/v2`)
}

async function getSimilarQuestions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionId = params.question_id
  if (!questionId) throw new Error('question_id is required')
  return fetchApi(page, `/api/v4/questions/${questionId}/similar-questions`, {
    include: 'data[*].answer_count,author,follower_count',
    limit: params.limit ?? 5,
  })
}

async function getRecommendFeed(page: Page, params: Record<string, unknown>): Promise<unknown> {
  return fetchApi(page, '/api/v3/feed/topstory/recommend', {
    limit: params.limit ?? 10,
    desktop: params.desktop ?? 'true',
  })
}

async function getUserActivities(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const urlToken = String(params.url_token ?? '')
  if (!urlToken) throw new Error('url_token is required')
  return fetchApi(page, `/api/v3/moments/${encodeURIComponent(urlToken)}/activities`, {
    limit: params.limit ?? 5,
    desktop: params.desktop ?? 'true',
  })
}

async function getTopicChildren(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const topicId = params.topic_id
  if (!topicId) throw new Error('topic_id is required')
  return fetchApi(page, `/api/v3/topics/${topicId}/children`)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchContent,
  getUserProfile,
  getUserAnswers,
  getHotSearch,
  getTopicIntro,
  getTopicFeed,
  getSimilarQuestions,
  getRecommendFeed,
  getUserActivities,
  getTopicChildren,
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
    const handler = OPERATIONS[operation]
    if (!handler) throw new Error(`Unknown operation: ${operation}`)
    return handler(page, { ...params })
  },
}

export default adapter
