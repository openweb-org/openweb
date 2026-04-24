import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'x-requested-with': 'XMLHttpRequest',
}

const AUTH_EXPIRED_STATUSES = new Set([
  'login_required',
  'checkpoint_required',
  'consent_required',
])

type Errors = AdapterHelpers['errors']
type R = Record<string, unknown>

function guardAuthExpired(data: unknown, errors: Errors): unknown {
  if (data == null) throw errors.needsLogin()
  if (typeof data !== 'object') return data
  const obj = data as R
  if (typeof obj.status === 'string' && AUTH_EXPIRED_STATUSES.has(obj.status)) {
    throw errors.needsLogin()
  }
  if (typeof obj.message === 'string' && AUTH_EXPIRED_STATUSES.has(obj.message)) {
    throw errors.needsLogin()
  }
  if ('data' in obj && obj.data == null && Object.keys(obj).length <= 2) {
    throw errors.needsLogin()
  }
  if (obj.require_login === true) {
    throw errors.needsLogin()
  }
  return data
}

async function fetchJson(
  helpers: AdapterHelpers,
  page: Page,
  url: string,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const result = await pageFetch(page, {
    url,
    method: 'GET',
    headers: IG_HEADERS,
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  let data: unknown
  try { data = JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
  return guardAuthExpired(data, errors)
}

async function getCsrfToken(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? '')
  } catch {
    const cookies = await page.context().cookies()
    return cookies.find((c) => c.name === 'csrftoken')?.value || ''
  }
}

async function postJson(
  helpers: AdapterHelpers,
  page: Page,
  url: string,
  body: string,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const csrf = await getCsrfToken(page)
  const headers: Record<string, string> = {
    ...IG_HEADERS,
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (csrf) headers['x-csrftoken'] = csrf

  const result = await pageFetch(page, { url, method: 'POST', headers, body, credentials: 'include' })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  let data: unknown
  try { data = JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
  return guardAuthExpired(data, errors)
}

async function postFriendship(
  helpers: AdapterHelpers,
  page: Page,
  action: string,
  userId: string,
): Promise<unknown> {
  const url = `https://www.instagram.com/api/v1/friendships/${action}/${userId}/`
  return postJson(helpers, page, url, '')
}

interface PolarisGraphQLArgs {
  friendlyName: string
  docId: string
  variables: Record<string, unknown>
  rootField?: string
}

async function polarisGraphQL(
  helpers: AdapterHelpers,
  page: Page,
  args: PolarisGraphQLArgs,
): Promise<unknown> {
  const { errors } = helpers
  const tokens = await page.evaluate(() => {
    const html = document.documentElement.outerHTML
    const dtsg = html.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/)?.[1]
      || html.match(/"token":"(NA[A-Za-z0-9_-]{20,})"/)?.[1]
      || null
    const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] || null
    const av = html.match(/"actorID":"(\d+)"/)?.[1]
      || document.cookie.match(/ds_user_id=([^;]+)/)?.[1]
      || null
    return { dtsg, lsd, av }
  })
  if (!tokens.dtsg || !tokens.lsd || !tokens.av) {
    throw errors.needsLogin()
  }
  const body = new URLSearchParams({
    av: tokens.av,
    __a: '1',
    __user: '0',
    fb_dtsg: tokens.dtsg,
    lsd: tokens.lsd,
    jazoest: '26000',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: args.friendlyName,
    variables: JSON.stringify(args.variables),
    server_timestamps: 'true',
    doc_id: args.docId,
  }).toString()
  const csrf = await getCsrfToken(page)
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'x-fb-friendly-name': args.friendlyName,
    'x-fb-lsd': tokens.lsd,
    'x-ig-app-id': '936619743392459',
    'x-asbd-id': '359341',
  }
  if (csrf) headers['x-csrftoken'] = csrf
  if (args.rootField) headers['x-root-field-name'] = args.rootField

  const result = await helpers.pageFetch(page, {
    url: 'https://www.instagram.com/graphql/query',
    method: 'POST',
    headers,
    body,
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.retriable(`Instagram returned HTTP ${result.status}`)
  let data: unknown
  try { data = JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
  return guardAuthExpired(data, errors)
}

// ── Trim helpers ──────────────────────────────────────────────

function trimUser(u: R): R {
  return {
    pk: String(u.pk ?? u.id ?? ''),
    username: u.username,
    full_name: u.full_name,
    is_private: u.is_private,
    is_verified: u.is_verified,
    profile_pic_url: u.profile_pic_url,
  }
}

function trimSearchUser(u: R): R {
  return {
    ...trimUser(u),
    ...(u.follower_count != null ? { follower_count: u.follower_count } : {}),
    ...(u.friendship_status ? {
      friendship_status: { following: (u.friendship_status as R).following },
    } : {}),
  }
}

function trimImageVersions(iv2: R | undefined): R | undefined {
  if (!iv2) return undefined
  const candidates = (iv2.candidates as Array<R>) ?? []
  return {
    candidates: candidates.map(c => ({
      width: c.width,
      height: c.height,
      url: c.url,
    })),
  }
}

function trimVideoVersions(vv: Array<R> | undefined): Array<R> | undefined {
  if (!vv?.length) return undefined
  return vv.map(v => ({ width: v.width, height: v.height, url: v.url }))
}

function trimMediaItem(item: R): R {
  const caption = item.caption as R | null
  const user = item.user as R | undefined
  return {
    pk: String(item.pk ?? ''),
    id: item.id,
    code: item.code,
    media_type: item.media_type,
    taken_at: item.taken_at,
    ...(caption ? { caption: { text: caption.text } } : {}),
    like_count: item.like_count,
    comment_count: item.comment_count,
    image_versions2: trimImageVersions(item.image_versions2 as R | undefined),
    ...(item.video_versions ? { video_versions: trimVideoVersions(item.video_versions as Array<R>) } : {}),
    ...(user ? { user: { pk: String(user.pk ?? ''), username: user.username } } : {}),
    ...(item.carousel_media ? {
      carousel_media: (item.carousel_media as Array<R>).map(cm => ({
        pk: String(cm.pk ?? ''),
        media_type: cm.media_type,
        image_versions2: trimImageVersions(cm.image_versions2 as R | undefined),
        ...(cm.video_versions ? { video_versions: trimVideoVersions(cm.video_versions as Array<R>) } : {}),
      })),
    } : {}),
  }
}

function trimComment(c: R): R {
  const user = c.user as R | undefined
  return {
    pk: String(c.pk ?? ''),
    text: c.text,
    created_at: c.created_at,
    ...(user ? { user: trimUser(user) } : {}),
    comment_like_count: c.comment_like_count,
    child_comment_count: c.child_comment_count,
  }
}

function trimStoryItem(item: R): R {
  return {
    pk: String(item.pk ?? ''),
    media_type: item.media_type,
    taken_at: item.taken_at,
    expiring_at: item.expiring_at,
    image_versions2: trimImageVersions(item.image_versions2 as R | undefined),
    ...(item.video_versions ? { video_versions: trimVideoVersions(item.video_versions as Array<R>) } : {}),
  }
}

function trimNotification(story: R): R {
  const args = story.args as R | undefined
  return {
    type: story.type,
    ...(args ? {
      args: {
        text: args.text,
        profile_id: args.profile_id,
        profile_name: args.profile_name,
        timestamp: args.timestamp,
      },
    } : {}),
  }
}

// ── Operation handlers ────────────────────────────────────────

type Handler = (page: Page, params: Readonly<R>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async searchUsers(page, params, helpers) {
    const query = String(params.query || '')
    if (!query) throw helpers.errors.missingParam('query')
    const context = String(params.context || 'blended')
    const url = `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(query)}&context=${context}&include_reel=true`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      users: ((data.users as Array<R>) ?? []).map(entry => ({
        position: entry.position,
        user: trimSearchUser(entry.user as R),
      })),
      places: data.places ?? [],
      hashtags: data.hashtags ?? [],
      has_more: data.has_more,
      status: data.status,
    }
  },

  async getUserProfile(page, params, helpers) {
    const username = String(params.username || '')
    if (!username) throw helpers.errors.missingParam('username')
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    const data = (await fetchJson(helpers, page, url)) as R
    const user = ((data.data as R)?.user as R) ?? {}
    const bioLinks = (user.bio_links as Array<R>) ?? []
    return {
      data: {
        user: {
          biography: user.biography,
          bio_links: bioLinks.map(l => ({ title: l.title, url: l.url })),
          external_url: user.external_url,
          edge_followed_by: user.edge_followed_by,
          edge_follow: user.edge_follow,
          full_name: user.full_name,
          id: user.id,
          is_private: user.is_private,
          is_verified: user.is_verified,
          profile_pic_url: user.profile_pic_url,
          profile_pic_url_hd: user.profile_pic_url_hd,
          username: user.username,
          edge_owner_to_timeline_media: {
            count: (user.edge_owner_to_timeline_media as R)?.count,
          },
        },
      },
      status: data.status,
    }
  },

  async getPost(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const url = `https://www.instagram.com/api/v1/media/${id}/info/`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      num_results: data.num_results,
      more_available: data.more_available,
      items: ((data.items as Array<R>) ?? []).map(trimMediaItem),
      status: data.status,
    }
  },

  async getFeed(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? String(params.max_id) : ''
    let url = `https://www.instagram.com/api/v1/feed/user/${id}/?count=${count}`
    if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      num_results: data.num_results,
      more_available: data.more_available,
      next_max_id: data.next_max_id,
      items: ((data.items as Array<R>) ?? []).map(trimMediaItem),
      status: data.status,
    }
  },

  async getUserPosts(page, params, helpers) {
    const { errors } = helpers
    const username = String(params.username || '')
    if (!username) throw errors.missingParam('username')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? String(params.max_id) : ''

    const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    const profile = (await fetchJson(helpers, page, profileUrl)) as R
    const user = ((profile?.data as R)?.user as R) ?? {}
    if (!user?.id) throw errors.fatal(`User "${username}" not found`)

    let feedUrl = `https://www.instagram.com/api/v1/feed/user/${user.id}/?count=${count}`
    if (maxId) feedUrl += `&max_id=${encodeURIComponent(maxId)}`
    const feed = (await fetchJson(helpers, page, feedUrl)) as R

    return {
      user: { id: user.id, username: user.username, full_name: user.full_name },
      num_results: feed.num_results,
      more_available: feed.more_available,
      next_max_id: feed.next_max_id,
      items: ((feed.items as Array<R>) ?? []).map(trimMediaItem),
    }
  },

  async getPostComments(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const threading = String(params.can_support_threading ?? 'true')
    const minId = params.min_id ? `&min_id=${encodeURIComponent(String(params.min_id))}` : ''
    const url = `https://www.instagram.com/api/v1/media/${id}/comments/?can_support_threading=${threading}${minId}`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      comments: ((data.comments as Array<R>) ?? []).map(trimComment),
      comment_count: data.comment_count,
      has_more_comments: data.has_more_comments,
      next_min_id: data.next_min_id,
      status: data.status,
    }
  },

  async getStories(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const url = `https://www.instagram.com/api/v1/feed/user/${id}/story/`
    const data = (await fetchJson(helpers, page, url)) as R
    const reel = data.reel as R | null
    if (!reel) return { reel: null, status: data.status }
    const user = reel.user as R | undefined
    return {
      reel: {
        id: reel.id,
        items: ((reel.items as Array<R>) ?? []).map(trimStoryItem),
        user: user ? trimUser(user) : undefined,
      },
      status: data.status,
    }
  },

  async getExplore(page, params, helpers) {
    const maxId = params.max_id ? `?max_id=${encodeURIComponent(String(params.max_id))}` : ''
    const url = `https://www.instagram.com/api/v1/discover/web/explore_grid/${maxId}`
    const data = (await fetchJson(helpers, page, url)) as R
    const sections = (data.sectional_items as Array<R>) ?? []
    const items: Array<R> = []
    for (const section of sections) {
      const lc = section.layout_content as R | undefined
      if (!lc) continue
      const medias = (lc.medias as Array<R>) ?? []
      const fillItems = (lc.fill_items as Array<R>) ?? []
      const clipItems = ((lc.one_by_two_item as R)?.clips as R)?.items as Array<R> ?? []
      for (const entry of [...medias, ...fillItems, ...clipItems]) {
        const m = (entry.media as R) ?? entry
        if (m.pk) items.push(trimMediaItem(m))
      }
    }
    return {
      items,
      more_available: data.more_available,
      next_max_id: data.next_max_id,
      status: data.status,
    }
  },

  async getFollowers(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? `&max_id=${encodeURIComponent(String(params.max_id))}` : ''
    const url = `https://www.instagram.com/api/v1/friendships/${id}/followers/?count=${count}${maxId}`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      users: ((data.users as Array<R>) ?? []).map(trimUser),
      ...(data.next_max_id != null ? { next_max_id: String(data.next_max_id) } : {}),
      big_list: data.big_list,
      status: data.status,
    }
  },

  async getFollowing(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? `&max_id=${encodeURIComponent(String(params.max_id))}` : ''
    const url = `https://www.instagram.com/api/v1/friendships/${id}/following/?count=${count}${maxId}`
    const data = (await fetchJson(helpers, page, url)) as R
    return {
      users: ((data.users as Array<R>) ?? []).map(trimUser),
      ...(data.next_max_id != null ? { next_max_id: String(data.next_max_id) } : {}),
      big_list: data.big_list,
      status: data.status,
    }
  },

  async getReels(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    const count = Number(params.count) || 12
    const maxId = params.max_id ? String(params.max_id) : ''
    let body = `target_user_id=${userId}&page_size=${count}`
    if (maxId) body += `&max_id=${encodeURIComponent(maxId)}`
    const data = (await postJson(helpers, page, 'https://www.instagram.com/api/v1/clips/user/', body)) as R
    const items = (data.items as Array<R>) ?? []
    const pi = data.paging_info as R | undefined
    return {
      items: items.map(entry => {
        const m = (entry.media as R) ?? entry
        return { media: { ...trimMediaItem(m), play_count: m.play_count } }
      }),
      paging_info: pi ? { max_id: pi.max_id, more_available: pi.more_available } : undefined,
      status: data.status,
    }
  },

  async getNotifications(page, _params, helpers) {
    const data = (await postJson(helpers, page, 'https://www.instagram.com/api/v1/news/inbox/', '')) as R
    const counts = data.counts as R | undefined
    return {
      counts: counts ? {
        relationships: counts.relationships,
        usertags: counts.usertags,
        comments: counts.comments,
        likes: counts.likes,
      } : undefined,
      new_stories: ((data.new_stories as Array<R>) ?? []).map(trimNotification),
      old_stories: ((data.old_stories as Array<R>) ?? []).map(trimNotification),
      status: data.status,
    }
  },

  async followUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postFriendship(helpers, page, 'create', userId)
  },

  async unfollowUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postFriendship(helpers, page, 'destroy', userId)
  },

  async muteUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postJson(
      helpers, page,
      'https://www.instagram.com/api/v1/friendships/mute_posts_or_story_from_follow/',
      `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    )
  },

  async unmuteUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postJson(
      helpers, page,
      'https://www.instagram.com/api/v1/friendships/unmute_posts_or_story_from_follow/',
      `target_posts_author_id=${userId}&target_reel_author_id=${userId}`,
    )
  },

  async blockUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return postJson(
      helpers, page,
      `https://www.instagram.com/api/v1/web/friendships/${userId}/block/`,
      '',
    )
  },

  async unblockUser(page, params, helpers) {
    const userId = String(params.id || '')
    if (!userId) throw helpers.errors.missingParam('id')
    return polarisGraphQL(helpers, page, {
      friendlyName: 'usePolarisUnblockMutation',
      docId: '10028948420505007',
      variables: { target_user_id: userId },
      rootField: 'xdt_unblock',
    })
  },

  async likePost(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    return postJson(helpers, page, `https://www.instagram.com/api/v1/web/likes/${id}/like/`, '')
  },

  async unlikePost(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    return postJson(helpers, page, `https://www.instagram.com/api/v1/web/likes/${id}/unlike/`, '')
  },

  async savePost(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    return postJson(helpers, page, `https://www.instagram.com/api/v1/web/save/${id}/save/`, '')
  },

  async unsavePost(page, params, helpers) {
    const id = String(params.id || '')
    if (!id) throw helpers.errors.missingParam('id')
    return postJson(helpers, page, `https://www.instagram.com/api/v1/web/save/${id}/unsave/`, '')
  },

  async createComment(page, params, helpers) {
    const id = String(params.id || '')
    const text = String(params.comment_text || '')
    if (!id) throw helpers.errors.missingParam('id')
    if (!text) throw helpers.errors.missingParam('comment_text')
    const body = `comment_text=${encodeURIComponent(text)}`
    return postJson(helpers, page, `https://www.instagram.com/api/v1/web/comments/${id}/add/`, body)
  },

  async deleteComment(page, params, helpers) {
    const mediaId = String(params.media_id || '')
    const commentId = String(params.comment_id || '')
    if (!mediaId) throw helpers.errors.missingParam('media_id')
    if (!commentId) throw helpers.errors.missingParam('comment_id')
    return postJson(
      helpers, page,
      `https://www.instagram.com/api/v1/web/comments/${mediaId}/delete/${commentId}/`,
      '',
    )
  },
}

const runner: CustomRunner = {
  name: 'instagram-api',
  description: 'Instagram — all operations with response trimming via REST v1',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('instagram-api requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
