import type { Page } from 'patchright'
import type { PageFetchOptions, PageFetchResult } from '../../../lib/adapter-helpers.js'

/**
 * Facebook L3 adapter — executes internal GraphQL queries via /api/graphql/.
 *
 * Resolves fb_dtsg CSRF token from page JS context, discovers doc_id hashes
 * from script bundles, and executes POST requests with proper form encoding.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type PageFetchFn = (page: Page, options: PageFetchOptions) => Promise<PageFetchResult>

/** Map stable operation names to Facebook's internal GraphQL friendly names */
const QUERY_FRIENDLY_NAME: Record<string, string> = {
  getProfile: 'ProfileCometTimelineListViewRefetchQuery',
  getFeed: 'CometFeedRootQuery',
  searchPosts: 'SearchCometResultsPaginatedResultsQuery',
  getEvents: 'CometEventsHomeRootQuery',
  getGroups: 'GroupsCometGroupsYourGroupsHPTabQuery',
}

const GQL_ENDPOINT = 'https://www.facebook.com/api/graphql/'

/** Extract fb_dtsg CSRF token from the page context */
async function getFbDtsg(page: Page, errors: Errors): Promise<string> {
  const token = await page.evaluate(() => {
    // Method 1: DTSGInitData require module
    try {
      const w = window as any
      if (w.require) {
        const dtsg = w.require('DTSGInitData')
        if (dtsg?.token) return dtsg.token as string
      }
    } catch {
      /* not available */
    }
    // Method 2: __eqmc global
    try {
      const eqmc = (window as any).__eqmc
      if (eqmc?.f) return eqmc.f as string
    } catch {
      /* not available */
    }
    // Method 3: hidden input field
    const input = document.querySelector<HTMLInputElement>('input[name="fb_dtsg"]')
    if (input?.value) return input.value
    // Method 4: scan script tags for token pattern
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent ?? ''
      const match = text.match(/"DTSGInitData".*?"token":"([^"]+)"/)
      if (match?.[1]) return match[1]
    }
    return ''
  })
  if (!token) throw errors.fatal('Could not extract fb_dtsg — session may be expired')
  return token
}

/** Discover doc_id for a given friendly name by scanning page script bundles */
async function discoverDocId(
  page: Page,
  friendlyName: string,
  errors: Errors,
): Promise<string> {
  const docId = await page.evaluate((queryName: string) => {
    // Scan all script elements for doc_id registration patterns
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent ?? ''
      // Pattern: {id:"<doc_id>",metadata:{},name:"<friendly_name>"}
      const patterns = [
        new RegExp(`\\{id:"(\\d+)"[^}]*name:"${queryName}"`),
        new RegExp(`"(\\d{10,})"[^"]*"${queryName}"`),
      ]
      for (const re of patterns) {
        const match = text.match(re)
        if (match?.[1]) return match[1]
      }
    }
    // Also check async-loaded script bundles via preloaded relay queries
    const relay = (window as any).__relay_require
    if (typeof relay === 'function') {
      try {
        const mod = relay(queryName)
        if (mod?.params?.id) return mod.params.id as string
      } catch {
        /* module not available */
      }
    }
    return ''
  }, friendlyName)
  if (!docId) throw errors.retriable(`Could not discover doc_id for ${friendlyName} — Facebook may have rotated query hashes`)
  return docId
}

/** Execute a GraphQL query against Facebook's internal API */
async function graphqlFetch(
  pageFetch: PageFetchFn,
  page: Page,
  fbDtsg: string,
  docId: string,
  friendlyName: string,
  variables: Record<string, unknown>,
  errors: Errors,
): Promise<unknown> {
  const body = new URLSearchParams({
    fb_dtsg: fbDtsg,
    doc_id: docId,
    fb_api_req_friendly_name: friendlyName,
    variables: JSON.stringify(variables),
  }).toString()

  const result = await pageFetch(page, {
    url: GQL_ENDPOINT,
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-friendly-name': friendlyName,
    },
    body,
    credentials: 'include',
  })

  if (result.status === 401 || result.status === 403) {
    throw errors.fatal(`Facebook returned ${result.status} — login required`)
  }
  if (result.status >= 400) {
    throw errors.retriable(`Facebook returned HTTP ${result.status}`)
  }

  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal('Response is not valid JSON — possible bot detection redirect')
  }
}

// --- Operation handlers ---

async function getProfile(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const fbDtsg = await getFbDtsg(page, errors)
  const friendlyName = QUERY_FRIENDLY_NAME.getProfile
  const docId = await discoverDocId(page, friendlyName, errors)

  const raw = (await graphqlFetch(pageFetch, page, fbDtsg, docId, friendlyName, {
    vanity: username,
  }, errors)) as Record<string, unknown>

  // Navigate Facebook's nested GraphQL response
  const data = raw?.data as Record<string, unknown> | undefined
  const user = data?.user as Record<string, unknown> | undefined
  if (!user) throw errors.retriable(`Profile "${username}" not found or not accessible`)

  return {
    id: user.id ?? user.userID,
    name: user.name,
    username,
    bio: user.bio ?? user.about ?? null,
    profile_pic_url: user.profilePicLarge?.uri ?? user.profile_picture?.uri ?? null,
    cover_photo_url: user.cover_photo?.photo?.image?.uri ?? null,
    follower_count: user.follower_count ?? user.followers_count ?? null,
    friend_count: user.friend_count ?? user.friends?.count ?? null,
    is_verified: user.is_verified ?? false,
    work: Array.isArray(user.work) ? user.work : [],
    education: Array.isArray(user.education) ? user.education : [],
    websites: Array.isArray(user.websites) ? user.websites : [],
  }
}

async function getFeed(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const count = Number(params.count) || 10
  const cursor = params.cursor ? String(params.cursor) : undefined

  const fbDtsg = await getFbDtsg(page, errors)
  const friendlyName = QUERY_FRIENDLY_NAME.getFeed
  const docId = await discoverDocId(page, friendlyName, errors)

  const variables: Record<string, unknown> = { count }
  if (cursor) variables.cursor = cursor

  const raw = (await graphqlFetch(pageFetch, page, fbDtsg, docId, friendlyName, variables, errors)) as Record<string, unknown>
  const data = raw?.data as Record<string, unknown> | undefined
  const feed = data?.node?.newsFeed ?? data?.viewer?.news_feed
  const edges = (feed as Record<string, unknown>)?.edges as Array<Record<string, unknown>> | undefined
  const pageInfo = (feed as Record<string, unknown>)?.page_info as Record<string, unknown> | undefined

  const items = (edges ?? []).map((edge) => {
    const node = edge.node as Record<string, unknown>
    const story = (node?.comet_sections?.content?.story ?? node) as Record<string, unknown>
    const author = (story?.actors?.[0] ?? story?.author ?? {}) as Record<string, unknown>
    const feedback = (node?.comet_sections?.feedback ?? story?.feedback) as Record<string, unknown> | undefined
    return {
      post_id: node?.post_id ?? node?.id,
      author: {
        id: author.id,
        name: author.name,
        profile_pic_url: author.profile_picture?.uri ?? null,
      },
      text: story?.message?.text ?? null,
      created_time: story?.creation_time ? new Date(Number(story.creation_time) * 1000).toISOString() : null,
      reaction_count: feedback?.reaction_count?.count ?? 0,
      comment_count: feedback?.comment_count?.total_count ?? 0,
      share_count: feedback?.share_count?.count ?? 0,
      attachments: [],
    }
  })

  return {
    items,
    has_next_page: pageInfo?.has_next_page ?? false,
    end_cursor: pageInfo?.end_cursor ?? null,
  }
}

async function searchPosts(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const query = String(params.query || '')
  if (!query) throw errors.missingParam('query')
  const count = Number(params.count) || 10
  const cursor = params.cursor ? String(params.cursor) : undefined

  const fbDtsg = await getFbDtsg(page, errors)
  const friendlyName = QUERY_FRIENDLY_NAME.searchPosts
  const docId = await discoverDocId(page, friendlyName, errors)

  const variables: Record<string, unknown> = {
    query,
    count,
    filter: 'posts',
  }
  if (cursor) variables.cursor = cursor

  const raw = (await graphqlFetch(pageFetch, page, fbDtsg, docId, friendlyName, variables, errors)) as Record<string, unknown>
  const data = raw?.data as Record<string, unknown> | undefined
  const search = data?.serpResponse ?? data?.search
  const edges = (search as Record<string, unknown>)?.results?.edges as Array<Record<string, unknown>> | undefined
  const pageInfo = (search as Record<string, unknown>)?.results?.page_info as Record<string, unknown> | undefined

  const results = (edges ?? []).map((edge) => {
    const node = (edge.node?.story ?? edge.node) as Record<string, unknown>
    const author = (node?.actors?.[0] ?? {}) as Record<string, unknown>
    return {
      post_id: node?.post_id ?? node?.id,
      author: {
        id: author.id,
        name: author.name,
        profile_pic_url: author.profile_picture?.uri ?? null,
      },
      text: node?.message?.text ?? null,
      created_time: node?.creation_time ? new Date(Number(node.creation_time) * 1000).toISOString() : null,
      reaction_count: node?.feedback?.reaction_count?.count ?? 0,
      comment_count: node?.feedback?.comment_count?.total_count ?? 0,
    }
  })

  return {
    results,
    has_next_page: pageInfo?.has_next_page ?? false,
    end_cursor: pageInfo?.end_cursor ?? null,
  }
}

async function getEvents(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const count = Number(params.count) || 10
  const cursor = params.cursor ? String(params.cursor) : undefined

  const fbDtsg = await getFbDtsg(page, errors)
  const friendlyName = QUERY_FRIENDLY_NAME.getEvents
  const docId = await discoverDocId(page, friendlyName, errors)

  const variables: Record<string, unknown> = { count }
  if (cursor) variables.cursor = cursor

  const raw = (await graphqlFetch(pageFetch, page, fbDtsg, docId, friendlyName, variables, errors)) as Record<string, unknown>
  const data = raw?.data as Record<string, unknown> | undefined
  const eventsRoot = data?.viewer?.events_home ?? data?.events
  const edges = (eventsRoot as Record<string, unknown>)?.edges as Array<Record<string, unknown>> | undefined
  const pageInfo = (eventsRoot as Record<string, unknown>)?.page_info as Record<string, unknown> | undefined

  const events = (edges ?? []).map((edge) => {
    const node = edge.node as Record<string, unknown>
    const place = node?.event_place as Record<string, unknown> | undefined
    const host = (node?.event_hosts?.edges?.[0]?.node ?? {}) as Record<string, unknown>
    return {
      event_id: node?.id,
      name: node?.name ?? node?.title,
      description: node?.description?.text ?? null,
      start_time: node?.start_timestamp ? new Date(Number(node.start_timestamp) * 1000).toISOString() : null,
      end_time: node?.end_timestamp ? new Date(Number(node.end_timestamp) * 1000).toISOString() : null,
      location: place
        ? {
            name: place.name,
            address: place.address?.street ?? null,
            city: place.address?.city ?? null,
          }
        : null,
      cover_photo_url: node?.cover_photo?.photo?.image?.uri ?? null,
      going_count: node?.going_count?.count ?? 0,
      interested_count: node?.interested_count?.count ?? 0,
      host: { id: host.id, name: host.name },
    }
  })

  return {
    events,
    has_next_page: pageInfo?.has_next_page ?? false,
    end_cursor: pageInfo?.end_cursor ?? null,
  }
}

async function getGroups(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const count = Number(params.count) || 10
  const cursor = params.cursor ? String(params.cursor) : undefined

  const fbDtsg = await getFbDtsg(page, errors)
  const friendlyName = QUERY_FRIENDLY_NAME.getGroups
  const docId = await discoverDocId(page, friendlyName, errors)

  const variables: Record<string, unknown> = { count }
  if (cursor) variables.cursor = cursor

  const raw = (await graphqlFetch(pageFetch, page, fbDtsg, docId, friendlyName, variables, errors)) as Record<string, unknown>
  const data = raw?.data as Record<string, unknown> | undefined
  const groupsRoot = data?.viewer?.groups_tab ?? data?.groups
  const edges = (groupsRoot as Record<string, unknown>)?.edges as Array<Record<string, unknown>> | undefined
  const pageInfo = (groupsRoot as Record<string, unknown>)?.page_info as Record<string, unknown> | undefined

  const groups = (edges ?? []).map((edge) => {
    const node = edge.node as Record<string, unknown>
    return {
      group_id: node?.id,
      name: node?.name,
      description: node?.description?.text ?? null,
      cover_photo_url: node?.cover_photo?.photo?.image?.uri ?? null,
      member_count: node?.member_count ?? node?.group_member_profiles?.count ?? 0,
      privacy: node?.privacy ?? node?.group_privacy ?? 'UNKNOWN',
      last_activity: node?.last_activity_time
        ? new Date(Number(node.last_activity_time) * 1000).toISOString()
        : null,
    }
  })

  return {
    groups,
    has_next_page: pageInfo?.has_next_page ?? false,
    end_cursor: pageInfo?.end_cursor ?? null,
  }
}

// --- Adapter export ---

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, helpers: { errors: Errors; pageFetch: PageFetchFn }) => Promise<unknown>
> = {
  getProfile,
  getFeed,
  searchPosts,
  getEvents,
  getGroups,
}

const adapter = {
  name: 'facebook-graphql',
  description: 'Facebook — internal GraphQL API with fb_dtsg CSRF and rotating doc_id discovery',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('facebook.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies()
    return cookies.some((c) => c.name === 'c_user' && c.value.length > 0)
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: Errors; pageFetch: PageFetchFn },
  ): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
