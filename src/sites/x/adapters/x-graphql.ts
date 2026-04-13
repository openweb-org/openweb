import type { Page } from 'patchright'

/**
 * X (Twitter) L3 adapter — GraphQL API via browser fetch.
 *
 * Solves two problems that make browser_fetch insufficient:
 * 1. GraphQL query hashes rotate on every Twitter deploy → extracted at
 *    runtime from the main.js bundle (not hardcoded).
 * 2. Some endpoints (Followers, SearchTimeline) require a per-request
 *    x-client-transaction-id signature → generated via Twitter's own
 *    signing function in the webpack module cache.
 *
 * Bearer token and CSRF are handled inline — no constant_headers needed.
 */

// ── Operation name mapping ────────────────────────
// Maps our operationId → Twitter's internal GraphQL operation name.

const OP_NAME: Record<string, string> = {
  getHomeTimeline: 'HomeTimeline',
  getTweetDetail: 'TweetDetail',
  getUserByScreenName: 'UserByScreenName',
  searchTweets: 'SearchTimeline',
  getUserFollowers: 'Followers',
  getUserFollowing: 'Following',
  getUserTweets: 'UserTweets',
  getExplorePage: 'ExplorePage',
  likeTweet: 'FavoriteTweet',
  unlikeTweet: 'UnfavoriteTweet',
  createBookmark: 'CreateBookmark',
  deleteBookmark: 'DeleteBookmark',
  createRetweet: 'CreateRetweet',
  deleteRetweet: 'DeleteRetweet',
  createTweet: 'CreateTweet',
  deleteTweet: 'DeleteTweet',
  reply: 'CreateTweet',
  getNotifications: 'notifications/all',  // REST v2
  getUserLikes: 'Likes',
  getBookmarks: 'Bookmarks',
  deleteDM: 'DMMessageDeleteMutation',
}

const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// Signing module ID — this is the webpack module that exports the
// x-client-transaction-id generator as `jJ`. The module ID is stable
// across builds because it's a numeric hash of the source path.
// If it breaks, grep the main.js bundle for `"x-client-transaction-id"]=await`
// and find the enclosing module ID.
const SIGNER_MODULE_ID = 938838

// ── Helpers ───────────────────────────────────────

/** Extract all queryId→operationName pairs from Twitter's JS bundles. */
async function loadQueryIds(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const scripts = Array.from(document.querySelectorAll('script[src]'))
    const mainUrl = scripts.map(s => s.src).find(s => s.includes('/main.'))
    if (!mainUrl) return {}

    const resp = await fetch(mainUrl)
    const text = await resp.text()

    const map: Record<string, string> = {}
    const re = /queryId:"([^"]+)",operationName:"([^"]+)"/g
    let m: RegExpExecArray | null = re.exec(text)
    while (m !== null) {
      map[m[2]] = m[1]
      m = re.exec(text)
    }
    return map
  })
}

/** Make a GraphQL GET request with all required Twitter headers. */
async function graphqlGet(
  page: Page,
  path: string,
  queryParams: Record<string, string>,
): Promise<unknown> {
  return page.evaluate(
    async (args: { path: string; queryParams: Record<string, string>; bearer: string; signerModuleId: number }) => {
      const ct0 = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))
      const csrfToken = ct0 ? ct0.split('=')[1] : ''

      // Generate x-client-transaction-id via Twitter's own signing function
      let txnId: string | undefined
      try {
        const wp = (window as Record<string, unknown>).webpackChunk_twitter_responsive_web as unknown[]
        if (wp) {
          let req: ((id: number) => Record<string, unknown>) | null = null
          wp.push([[Symbol()], {}, (r: unknown) => { req = r as typeof req }])
          wp.pop()
          if (req) {
            const mod = (req as (id: number) => Record<string, (...a: string[]) => Promise<string>>)(args.signerModuleId)
            if (typeof mod?.jJ === 'function') {
              txnId = await mod.jJ('x.com', args.path, 'GET')
            }
          }
        }
      } catch { /* signing is best-effort */ }

      const pairs = Object.entries(args.queryParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
      const url = `https://x.com${args.path}${pairs ? `?${pairs}` : ''}`

      const headers: Record<string, string> = {
        Accept: 'application/json',
        authorization: args.bearer,
        'x-csrf-token': csrfToken,
      }
      if (txnId) headers['x-client-transaction-id'] = txnId

      const resp = await fetch(url, { headers, credentials: 'include' })
      const text = await resp.text()
      return { status: resp.status, text }
    },
    { path, queryParams, bearer: BEARER, signerModuleId: SIGNER_MODULE_ID },
  )
}

/** Make a GraphQL POST (mutation) request. */
async function graphqlPost(
  page: Page,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    async (args: { path: string; body: string; bearer: string; signerModuleId: number }) => {
      const ct0 = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))
      const csrfToken = ct0 ? ct0.split('=')[1] : ''

      let txnId: string | undefined
      try {
        const wp = (window as Record<string, unknown>).webpackChunk_twitter_responsive_web as unknown[]
        if (wp) {
          let req: ((id: number) => Record<string, unknown>) | null = null
          wp.push([[Symbol()], {}, (r: unknown) => { req = r as typeof req }])
          wp.pop()
          if (req) {
            const mod = (req as (id: number) => Record<string, (...a: string[]) => Promise<string>>)(args.signerModuleId)
            if (typeof mod?.jJ === 'function') {
              txnId = await mod.jJ('x.com', args.path, 'POST')
            }
          }
        }
      } catch { /* signing is best-effort */ }

      const url = `https://x.com${args.path}`
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        authorization: args.bearer,
        'x-csrf-token': csrfToken,
      }
      if (txnId) headers['x-client-transaction-id'] = txnId

      const resp = await fetch(url, { method: 'POST', headers, body: args.body, credentials: 'include' })
      const text = await resp.text()
      return { status: resp.status, text }
    },
    { path, body: JSON.stringify(body), bearer: BEARER, signerModuleId: SIGNER_MODULE_ID },
  )
}

/** Make a REST API request (v1.1 form-urlencoded or v2 JSON). */
async function restRequest(
  page: Page,
  method: string,
  path: string,
  contentType: string,
  body: string,
): Promise<unknown> {
  return page.evaluate(
    async (args: { method: string; path: string; contentType: string; body: string; bearer: string }) => {
      const ct0 = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))
      const csrfToken = ct0 ? ct0.split('=')[1] : ''

      const url = `https://x.com${args.path}`
      const headers: Record<string, string> = {
        Accept: 'application/json',
        authorization: args.bearer,
        'x-csrf-token': csrfToken,
      }
      if (args.method !== 'GET') headers['Content-Type'] = args.contentType

      const opts: RequestInit = { method: args.method, headers, credentials: 'include' as RequestCredentials }
      if (args.method !== 'GET' && args.body) opts.body = args.body

      const resp = await fetch(url, opts)
      const text = await resp.text()
      return { status: resp.status, text }
    },
    { method, path, contentType, body, bearer: BEARER },
  )
}

/** Execute a REST request with standard error handling. */
async function executeRest(
  page: Page,
  method: string,
  path: string,
  contentType: string,
  body: string,
  errors: Errors,
): Promise<unknown> {
  const result = await restRequest(page, method, path, contentType, body) as { status: number; text: string }
  if (result.status >= 400) throw errors.httpError(result.status)
  try {
    return JSON.parse(result.text)
  } catch {
    return result.text
  }
}

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
  fatal(msg: string): Error
}

// ── Query-Id cache ────────────────────────────────

let cachedQueryIds: Record<string, string> | null = null

async function getQueryId(page: Page, twitterOpName: string, errors: { fatal(msg: string): Error }): Promise<string> {
  if (!cachedQueryIds) {
    cachedQueryIds = await loadQueryIds(page)
  }
  const id = cachedQueryIds[twitterOpName]
  if (!id) throw errors.fatal(`QueryId not found for ${twitterOpName}. Twitter may have renamed the operation.`)
  return id
}

// ── Operation handlers ────────────────────────────

async function executeGraphqlGet(
  page: Page,
  twitterOpName: string,
  variables: Record<string, unknown>,
  features: Record<string, unknown>,
  fieldToggles: Record<string, unknown> | undefined,
  errors: Errors,
): Promise<unknown> {
  const queryId = await getQueryId(page, twitterOpName, errors)
  const path = `/i/api/graphql/${queryId}/${twitterOpName}`
  const queryParams: Record<string, string> = {
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  }
  if (fieldToggles) queryParams.fieldToggles = JSON.stringify(fieldToggles)

  const result = await graphqlGet(page, path, queryParams) as { status: number; text: string }

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text)
  if (json.errors?.length) {
    throw errors.apiError(twitterOpName, json.errors[0]?.message ?? 'Unknown error')
  }
  return json.data
}

async function executeGraphqlPost(
  page: Page,
  twitterOpName: string,
  variables: Record<string, unknown>,
  features: Record<string, unknown>,
  errors: Errors,
): Promise<unknown> {
  const queryId = await getQueryId(page, twitterOpName, errors)
  const path = `/i/api/graphql/${queryId}/${twitterOpName}`
  const body = { variables, features, queryId }

  const result = await graphqlPost(page, path, body) as { status: number; text: string }

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text)
  if (json.errors?.length) {
    throw errors.apiError(twitterOpName, json.errors[0]?.message ?? 'Unknown error')
  }
  return json.data
}

// ── Default feature flags ─────────────────────────
// Minimal set that Twitter accepts. The full set from the browser has ~36
// flags, but Twitter works with a sparse set — only flags the server
// actually checks are needed.

const DEFAULT_FEATURES: Record<string, boolean> = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  responsive_web_enhance_cards_enabled: false,
}

// ── Per-operation dispatch ────────────────────────

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  getHomeTimeline: async (page, params, errors) =>
    executeGraphqlGet(page, 'HomeTimeline', {
      count: Number(params.count) || 20,
      includePromotedContent: true,
      requestContext: 'launch',
      withCommunity: true,
    }, DEFAULT_FEATURES, undefined, errors),

  getTweetDetail: async (page, params, errors) => {
    const focalTweetId = String(params.focalTweetId ?? '')
    if (!focalTweetId) throw errors.missingParam('focalTweetId')
    return executeGraphqlGet(page, 'TweetDetail', {
      focalTweetId,
      referrer: 'profile',
      with_rux_injections: false,
      rankingMode: 'Relevance',
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
    }, DEFAULT_FEATURES, {
      withArticleRichContentState: true,
      withArticlePlainText: false,
      withArticleSummaryText: true,
      withArticleVoiceOver: true,
      withGrokAnalyze: false,
      withDisallowedReplyControls: false,
    }, errors)
  },

  getUserByScreenName: async (page, params, errors) => {
    const screen_name = String(params.screen_name ?? '')
    if (!screen_name) throw errors.missingParam('screen_name')
    return executeGraphqlGet(page, 'UserByScreenName', {
      screen_name,
      withGrokTranslatedBio: true,
    }, {
      hidden_profile_subscriptions_enabled: true,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
    }, {
      withPayments: false,
      withAuxiliaryUserLabels: true,
    }, errors)
  },

  searchTweets: async (page, params, errors) => {
    const rawQuery = String(params.rawQuery ?? '')
    if (!rawQuery) throw errors.missingParam('rawQuery')
    return executeGraphqlGet(page, 'SearchTimeline', {
      rawQuery,
      count: Number(params.count) || 20,
      querySource: String(params.querySource ?? 'typed_query'),
      product: String(params.product ?? 'Top'),
      withGrokTranslatedBio: false,
    }, DEFAULT_FEATURES, undefined, errors)
  },

  getUserFollowers: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeGraphqlGet(page, 'Followers', {
      userId,
      count: Number(params.count) || 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    }, DEFAULT_FEATURES, undefined, errors)
  },

  getUserFollowing: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeGraphqlGet(page, 'Following', {
      userId,
      count: Number(params.count) || 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    }, DEFAULT_FEATURES, undefined, errors)
  },

  getUserTweets: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeGraphqlGet(page, 'UserTweets', {
      userId,
      count: Number(params.count) || 20,
      includePromotedContent: true,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
    }, DEFAULT_FEATURES, undefined, errors)
  },

  getExplorePage: async (page, params, errors) =>
    executeGraphqlGet(page, 'ExplorePage', {
      cursor: String(params.cursor ?? ''),
    }, DEFAULT_FEATURES, undefined, errors),

  likeTweet: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'FavoriteTweet', { tweet_id }, {}, errors)
  },

  unlikeTweet: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'UnfavoriteTweet', { tweet_id }, {}, errors)
  },

  createBookmark: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'CreateBookmark', { tweet_id }, {}, errors)
  },

  deleteBookmark: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'DeleteBookmark', { tweet_id }, {}, errors)
  },

  createRetweet: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'CreateRetweet', { tweet_id }, {}, errors)
  },

  deleteRetweet: async (page, params, errors) => {
    const source_tweet_id = String(params.source_tweet_id ?? '')
    if (!source_tweet_id) throw errors.missingParam('source_tweet_id')
    return executeGraphqlPost(page, 'DeleteRetweet', { source_tweet_id }, {}, errors)
  },

  createTweet: async (page, params, errors) => {
    const text = String(params.text ?? '')
    if (!text) throw errors.missingParam('text')
    return executeGraphqlPost(page, 'CreateTweet', {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, DEFAULT_FEATURES, errors)
  },

  deleteTweet: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'DeleteTweet', { tweet_id, dark_request: false }, {}, errors)
  },

  reply: async (page, params, errors) => {
    const text = String(params.text ?? '')
    const tweet_id = String(params.tweet_id ?? '')
    if (!text) throw errors.missingParam('text')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeGraphqlPost(page, 'CreateTweet', {
      tweet_text: text,
      reply: { in_reply_to_tweet_id: tweet_id, exclude_reply_user_ids: [] },
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }, DEFAULT_FEATURES, errors)
  },

  followUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/friendships/create.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  unfollowUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/friendships/destroy.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  blockUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/blocks/create.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  unblockUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/blocks/destroy.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  muteUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/mutes/users/create.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  unmuteUser: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeRest(page, 'POST', '/i/api/1.1/mutes/users/destroy.json',
      'application/x-www-form-urlencoded', `user_id=${userId}`, errors)
  },

  hideReply: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeRest(page, 'PUT', `/i/api/2/tweets/${tweet_id}/hidden`,
      'application/json', JSON.stringify({ hidden: true }), errors)
  },

  unhideReply: async (page, params, errors) => {
    const tweet_id = String(params.tweet_id ?? '')
    if (!tweet_id) throw errors.missingParam('tweet_id')
    return executeRest(page, 'PUT', `/i/api/2/tweets/${tweet_id}/hidden`,
      'application/json', JSON.stringify({ hidden: false }), errors)
  },

  sendDM: async (page, params, errors) => {
    const recipientId = String(params.recipientId ?? '')
    const text = String(params.text ?? '')
    if (!recipientId) throw errors.missingParam('recipientId')
    if (!text) throw errors.missingParam('text')
    const body = JSON.stringify({
      recipient_ids: recipientId,
      text,
      cards_platform: 'Web-12',
      include_cards: 1,
      include_quote_count: true,
      dm_secret_conversations_enabled: false,
    })
    return executeRest(page, 'POST', '/i/api/1.1/dm/new2.json',
      'application/json', body, errors)
  },

  deleteDM: async (page, params, errors) => {
    const messageId = String(params.messageId ?? '')
    if (!messageId) throw errors.missingParam('messageId')
    return executeGraphqlPost(page, 'DMMessageDeleteMutation', {
      messageId,
      requestId: `${Date.now()}`,
    }, {}, errors)
  },

  getNotifications: async (page, params, errors) => {
    const count = Number(params.count) || 20
    return executeRest(page, 'GET',
      `/i/api/2/notifications/all.json?count=${count}&include_profile_interstitial_type=1&skip_status=1&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&tweet_mode=extended&include_entities=true&include_user_entities=true`,
      '', '', errors)
  },

  getUserLikes: async (page, params, errors) => {
    const userId = String(params.userId ?? '')
    if (!userId) throw errors.missingParam('userId')
    return executeGraphqlGet(page, 'Likes', {
      userId,
      count: Number(params.count) || 20,
      includePromotedContent: false,
    }, DEFAULT_FEATURES, undefined, errors)
  },

  getBookmarks: async (page, params, errors) => {
    // Bookmarks queryId is in a lazy-loaded webpack chunk not available in main.js.
    // Extract it by navigating to the bookmarks page and capturing the API request URL.
    if (!cachedQueryIds) cachedQueryIds = await loadQueryIds(page)
    if (!cachedQueryIds.Bookmarks) {
      const prevUrl = page.url()
      const queryIdPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bookmark queryId capture timeout')), 15000)
        const handler = (req: { url(): string }) => {
          const match = req.url().match(/\/i\/api\/graphql\/([^/]+)\/Bookmarks\b/)
          if (match) {
            clearTimeout(timeout)
            page.removeListener('request', handler)
            resolve(match[1])
          }
        }
        page.on('request', handler)
      })
      await page.goto('https://x.com/i/bookmarks', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      try {
        const qid = await queryIdPromise
        cachedQueryIds.Bookmarks = qid
      } catch {
        throw errors.fatal('Could not discover Bookmarks queryId from Twitter navigation')
      }
      // Navigate back
      if (prevUrl && prevUrl !== page.url()) {
        await page.goto(prevUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
      }
    }
    return executeGraphqlGet(page, 'Bookmarks', {
      count: Number(params.count) || 20,
      includePromotedContent: true,
    }, DEFAULT_FEATURES, undefined, errors)
  },
}

// ── Adapter export ────────────────────────────────

const adapter = {
  name: 'x-graphql',
  description: 'X (Twitter) GraphQL adapter with dynamic hash resolution and request signing',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('x.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://x.com')
    return cookies.some(c => c.name === 'auth_token' || c.name === 'twid')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
