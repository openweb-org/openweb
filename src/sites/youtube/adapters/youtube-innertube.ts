import { createHash } from 'node:crypto'
import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * YouTube L2 runner — composes InnerTube API calls for multi-step operations.
 *
 * getComments: two-step — fetch video next page for comment continuation token,
 * then fetch comments via continuation. getPlaylist: wraps /browse with VL-prefixed
 * browseId for a cleaner playlistId-based interface. likeVideo/unlikeVideo: authenticated
 * InnerTube calls with sapisidhash signing.
 */

type Errors = AdapterHelpers['errors']

const API_BASE = 'https://www.youtube.com/youtubei/v1'
const DEFAULT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const DEFAULT_CLIENT_VERSION = '2.20260325.08.00'
const DEFAULT_CLIENT_NAME_NUM = '1'

interface YtConfig {
  key: string
  clientVersion: string
  clientNameNum: string
  visitorData: string
  /** Full INNERTUBE_CONTEXT pulled from ytcfg — required for writes; SPA sends ~30 client fields. */
  innertubeContext: Record<string, unknown> | null
}

async function getYtConfig(page: Page): Promise<YtConfig> {
  try {
    const config = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      const ytcfg = w.ytcfg as Record<string, unknown> | undefined
      if (!ytcfg) return null
      const data = (ytcfg.data_ || ytcfg.d) as Record<string, unknown> | undefined
      if (!data) return null
      return {
        key: String(data.INNERTUBE_API_KEY || ''),
        clientVersion: String(data.INNERTUBE_CLIENT_VERSION || ''),
        clientNameNum: String(data.INNERTUBE_CONTEXT_CLIENT_NAME || '1'),
        visitorData: String(data.VISITOR_DATA || ''),
        innertubeContext: (data.INNERTUBE_CONTEXT as Record<string, unknown>) || null,
      }
    })
    if (config?.key && config?.clientVersion) return config
  } catch { /* page may not have ytcfg loaded */ }
  return {
    key: DEFAULT_KEY,
    clientVersion: DEFAULT_CLIENT_VERSION,
    clientNameNum: DEFAULT_CLIENT_NAME_NUM,
    visitorData: '',
    innertubeContext: null,
  }
}

/** Build context for InnerTube body. Use full ytcfg INNERTUBE_CONTEXT when available — required for write ops. */
function makeContext(config: YtConfig): Record<string, unknown> {
  if (config.innertubeContext) return config.innertubeContext
  return { client: { clientName: 'WEB', clientVersion: config.clientVersion } }
}

/**
 * Compute the YouTube auth header. The server validates the hash against the
 * matching cookie: SAPISIDHASH ↔ SAPISID, SAPISID3PHASH ↔ __Secure-3PAPISID.
 * Use whichever cookie is available — sending the wrong prefix yields 401.
 */
function computeAuthHeader(cookieValue: string, prefix: string, origin: string): string {
  const ts = Math.floor(Date.now() / 1000)
  const hash = createHash('sha1').update(`${ts} ${cookieValue} ${origin}`).digest('hex')
  return `${prefix} ${ts}_${hash}_u`
}

/**
 * Get SAPISID cookie from browser context for authenticated requests.
 *
 * SAPISID lives on .google.com (Google SSO scope), NOT on .youtube.com — querying
 * only youtube.com misses it. __Secure-3PAPISID is the third-party variant that's
 * also set on .youtube.com so it actually rides along on requests to youtube.com.
 *
 * The YouTube SPA sends a multi-hash Authorization header so the server can pick
 * whichever prefix matches a cookie it can see in the request. We do the same:
 * concatenate hashes for every cookie we find so the server picks the matching
 * one (e.g. SAPISID3PHASH validates against the .youtube.com __Secure-3PAPISID
 * that the browser actually sends with the cross-origin fetch).
 */
async function getSapisidAuth(page: Page): Promise<string | undefined> {
  try {
    const ctx = page.context()
    const cookies = [
      ...(await ctx.cookies('https://www.google.com')),
      ...(await ctx.cookies('https://www.youtube.com')),
    ]
    const parts: string[] = []
    const sapisid = cookies.find(c => c.name === 'SAPISID')
    if (sapisid) parts.push(computeAuthHeader(sapisid.value, 'SAPISIDHASH', 'https://www.youtube.com'))
    const sapisid1p = cookies.find(c => c.name === '__Secure-1PAPISID')
    if (sapisid1p) parts.push(computeAuthHeader(sapisid1p.value, 'SAPISID1PHASH', 'https://www.youtube.com'))
    const sapisid3p = cookies.find(c => c.name === '__Secure-3PAPISID')
    if (sapisid3p) parts.push(computeAuthHeader(sapisid3p.value, 'SAPISID3PHASH', 'https://www.youtube.com'))
    return parts.length ? parts.join(' ') : undefined
  } catch {
    return undefined
  }
}

async function innertubePost(
  helpers: AdapterHelpers,
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
  config: YtConfig,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const url = `${API_BASE}/${endpoint}?key=${config.key}&prettyPrint=false`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-youtube-client-name': config.clientNameNum,
    'x-youtube-client-version': config.clientVersion,
  }
  if (config.visitorData) headers['x-goog-visitor-id'] = config.visitorData
  const result = await pageFetch(page, { url, method: 'POST', headers, body: JSON.stringify(body) })
  if (result.status >= 400) {
    throw errors.retriable(`InnerTube ${endpoint} returned HTTP ${result.status}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal(`InnerTube ${endpoint} returned invalid JSON`)
  }
}

/** Authenticated InnerTube POST — includes sapisidhash Authorization header plus full SPA-aligned headers. */
async function innertubeAuthPost(
  helpers: AdapterHelpers,
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
  config: YtConfig,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const auth = await getSapisidAuth(page)
  if (!auth) {
    throw errors.fatal('Not logged in to YouTube — SAPISID cookie not found')
  }
  const url = `${API_BASE}/${endpoint}?key=${config.key}&prettyPrint=false`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'authorization': auth,
    'x-goog-authuser': '0',
    'x-origin': 'https://www.youtube.com',
    'x-youtube-client-name': config.clientNameNum,
    'x-youtube-client-version': config.clientVersion,
    'x-youtube-bootstrap-logged-in': 'true',
  }
  if (config.visitorData) headers['x-goog-visitor-id'] = config.visitorData
  const result = await pageFetch(page, { url, method: 'POST', headers, body: JSON.stringify(body) })
  if (result.status === 401 || result.status === 403) {
    throw errors.fatal(`YouTube auth failed (HTTP ${result.status}) — login required`)
  }
  if (result.status >= 400) {
    throw errors.retriable(`InnerTube ${endpoint} returned HTTP ${result.status}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal(`InnerTube ${endpoint} returned invalid JSON`)
  }
}

// --- deep access helpers ---
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

function textRuns(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const simple = (obj as Record<string, unknown>).simpleText
  if (typeof simple === 'string') return simple
  const runs = (obj as Record<string, unknown>).runs as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(runs)) return ''
  return runs.map((r) => String(r.text || '')).join('')
}

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

// --- getComments ---
const getComments: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config)

  // Step 1: get the comment section continuation token from /next
  const nextResp = await innertubePost(helpers, page, 'next', { context, videoId }, config) as Record<string, unknown>

  // Find comment continuation token in the response
  const resultContents = dig(
    nextResp,
    'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents',
  ) as Array<Record<string, unknown>> | undefined

  let continuationToken: string | undefined
  if (Array.isArray(resultContents)) {
    for (const item of resultContents) {
      const section = item.itemSectionRenderer as Record<string, unknown> | undefined
      if (!section) continue
      const sectionContents = section.contents as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(sectionContents)) continue
      for (const inner of sectionContents) {
        const contRenderer = inner.continuationItemRenderer as Record<string, unknown> | undefined
        if (!contRenderer) continue
        const token = dig(contRenderer, 'continuationEndpoint', 'continuationCommand', 'token') as string | undefined
        if (token) { continuationToken = token; break }
      }
      if (continuationToken) break
    }
  }

  if (!continuationToken) {
    return { videoId, comments: [], totalComments: 0, note: 'No comment section found — video may have comments disabled' }
  }

  // Step 2: fetch comments via continuation
  const commentsResp = await innertubePost(
    helpers, page, 'next', { context, continuation: continuationToken }, config,
  ) as Record<string, unknown>

  // Parse comments from the entity-mutation store (2025+ InnerTube format).
  // Comment content lives in frameworkUpdates.entityBatchUpdate.mutations
  // as commentEntityPayload entries, ordered to match the thread renderers.
  const mutations = dig(commentsResp, 'frameworkUpdates', 'entityBatchUpdate', 'mutations') as Array<Record<string, unknown>> | undefined
  const comments: Array<Record<string, unknown>> = []

  if (Array.isArray(mutations)) {
    for (const mutation of mutations) {
      const payload = dig(mutation, 'payload', 'commentEntityPayload') as Record<string, unknown> | undefined
      if (!payload) continue
      const props = payload.properties as Record<string, unknown> | undefined
      const author = payload.author as Record<string, unknown> | undefined
      const toolbar = payload.toolbar as Record<string, unknown> | undefined
      if (!props) continue
      const replyCountStr = String(toolbar?.replyCount || '0')
      comments.push({
        commentId: props.commentId || '',
        author: (author?.displayName as string) || '',
        text: (dig(props, 'content', 'content') as string) || '',
        publishedTime: (props.publishedTime as string) || '',
        likeCount: (toolbar?.likeCountNotliked as string) || '0',
        replyCount: /^\d+$/.test(replyCountStr) ? Number(replyCountStr) : 0,
        authorThumbnail: (author?.avatarThumbnailUrl as string) || '',
      })
    }
  }

  // Try to extract total comment count from header.
  // YouTube uses reloadContinuationItemsCommand (2025+) or reloadContinuationItemsAction.
  const endpoints = commentsResp.onResponseReceivedEndpoints as Array<Record<string, unknown>> | undefined
  let totalComments = comments.length
  if (Array.isArray(endpoints)) {
    for (const ep of endpoints) {
      const cmd = (ep.reloadContinuationItemsCommand || ep.reloadContinuationItemsAction) as Record<string, unknown> | undefined
      const headerItem = dig(cmd, 'continuationItems', '0', 'commentsHeaderRenderer') as Record<string, unknown> | undefined
      if (!headerItem) continue
      const countText = textRuns(headerItem.countText)
      const match = countText?.match?.(/([\d,]+)/)
      if (match) { totalComments = Number(match[1].replace(/,/g, '')); break }
    }
  }

  return { videoId, totalComments, comments }
}

// --- getPlaylist ---
const getPlaylist: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const playlistId = String(params.playlistId || '')
  if (!playlistId) throw errors.missingParam('playlistId')

  const config = await getYtConfig(page)
  const context = makeContext(config)
  const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`

  const resp = await innertubePost(
    helpers, page, 'browse', { context, browseId }, config,
  ) as Record<string, unknown>

  // Parse playlist header
  const header = resp.header as Record<string, unknown> | undefined
  const headerRenderer = header?.playlistHeaderRenderer as Record<string, unknown> | undefined

  const title = textRuns(headerRenderer?.title)
  const description = textRuns(headerRenderer?.descriptionText)
  const ownerName = textRuns(dig(headerRenderer, 'ownerText'))
  const stats = (headerRenderer?.stats as Array<unknown> | undefined)?.map(textRuns) || []
  const videoCountText = stats[0] || ''
  const viewCountText = stats[1] || ''

  // Parse video list
  const tabs = dig(resp, 'contents', 'twoColumnBrowseResultsRenderer', 'tabs') as Array<Record<string, unknown>> | undefined
  const sectionContents = dig(
    tabs?.[0], 'tabRenderer', 'content', 'sectionListRenderer', 'contents',
  ) as Array<Record<string, unknown>> | undefined
  const playlistItems = dig(
    sectionContents?.[0], 'itemSectionRenderer', 'contents', '0', 'playlistVideoListRenderer', 'contents',
  ) as Array<Record<string, unknown>> | undefined

  const videos: Array<Record<string, unknown>> = []
  if (Array.isArray(playlistItems)) {
    for (const item of playlistItems) {
      const v = item.playlistVideoRenderer as Record<string, unknown> | undefined
      if (!v) continue
      videos.push({
        videoId: v.videoId || '',
        title: textRuns(v.title),
        duration: textRuns(v.lengthText),
        channelName: textRuns(v.shortBylineText),
        thumbnail: dig(v, 'thumbnail', 'thumbnails', '0', 'url') || '',
        index: textRuns(v.index),
      })
    }
  }

  return {
    playlistId,
    title,
    description,
    owner: ownerName,
    videoCount: videoCountText,
    viewCount: viewCountText,
    videos,
  }
}

// --- addComment ---
const addComment: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  const text = String(params.text || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!text) throw errors.missingParam('text')

  // Ensure page is on the watch URL so ytcfg has the watch-page INNERTUBE_CONTEXT
  // (originalUrl, mainAppWebInfo). Without this, YT's spam filter rejects writes.
  if (!page.url().includes(`watch?v=${videoId}`)) {
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1500)
  }

  const config = await getYtConfig(page)
  const context = makeContext(config)

  // Step 1: get createCommentParams from /next (comment creation token)
  const nextResp = await innertubePost(helpers, page, 'next', { context, videoId }, config) as Record<string, unknown>

  const resultContents = dig(
    nextResp,
    'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents',
  ) as Array<Record<string, unknown>> | undefined

  let createParams: string | undefined
  if (Array.isArray(resultContents)) {
    for (const item of resultContents) {
      const section = item.itemSectionRenderer as Record<string, unknown> | undefined
      if (!section) continue
      const sectionContents = section.contents as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(sectionContents)) continue
      for (const inner of sectionContents) {
        const contRenderer = inner.continuationItemRenderer as Record<string, unknown> | undefined
        if (!contRenderer) continue
        const token = dig(contRenderer, 'continuationEndpoint', 'continuationCommand', 'token') as string | undefined
        if (token) { createParams = token; break }
      }
      if (createParams) break
    }
  }

  if (!createParams) {
    throw errors.retriable('Could not extract comment creation params — comments may be disabled on this video')
  }

  // The continuation token above only fetches comments. The actual createCommentParams
  // lives in the comments header (commentSimpleboxRenderer) — fetch the comments first
  // (authenticated, so the composer renders for the logged-in user instead of a sign-in
  // prompt) and dig out the real submit param. Without this, /create_comment returns 404.
  const commentsResp = await innertubeAuthPost(
    helpers, page, 'next', { context, continuation: createParams }, config,
  ) as Record<string, unknown>
  let realCreateParams: string | undefined
  const stack: unknown[] = [commentsResp]
  while (stack.length) {
    const cur = stack.pop()
    if (cur && typeof cur === 'object') {
      const obj = cur as Record<string, unknown>
      const cp = obj.createCommentParams
      if (typeof cp === 'string') { realCreateParams = cp; break }
      for (const v of Object.values(obj)) stack.push(v)
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v)
    }
  }
  if (!realCreateParams) {
    throw errors.retriable('Could not find createCommentParams in comments header — the composer did not render (account likely lacks 1P SAPISID cookie; re-login needed)')
  }
  createParams = realCreateParams

  // Step 2: post the comment via /comment/create_comment (requires sapisidhash auth)
  const commentResp = await innertubeAuthPost(
    helpers, page, 'comment/create_comment',
    { context, createCommentParams: createParams, commentText: text },
    config,
  ) as Record<string, unknown>

  // Extract created comment ID from response
  const actions = commentResp.actionResults as Array<Record<string, unknown>> | undefined
  let commentId = ''
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const key = action.key as string | undefined
      if (key) { commentId = key; break }
    }
  }
  // Fallback: try frameworkUpdates path
  if (!commentId) {
    const mutations = dig(commentResp, 'frameworkUpdates', 'entityBatchUpdate', 'mutations') as Array<Record<string, unknown>> | undefined
    if (Array.isArray(mutations)) {
      for (const m of mutations) {
        const payload = dig(m, 'payload', 'commentEntityPayload', 'properties') as Record<string, unknown> | undefined
        if (payload?.commentId) { commentId = String(payload.commentId); break }
      }
    }
  }
  // Fallback: deep-search response for any "Ug…" (YouTube comment IDs prefix Ug).
  if (!commentId) {
    const stack: unknown[] = [commentResp]
    while (stack.length) {
      const cur = stack.pop()
      if (typeof cur === 'string') {
        if (/^Ug[\w-]{10,}/.test(cur)) { commentId = cur; break }
      } else if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v)
      } else if (cur && typeof cur === 'object') {
        for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v)
      }
    }
  }
  if (!commentId) {
    // YouTube returns HTTP 200 with a showErrorAction when its spam filter
    // rejects the comment — surface that distinct signal.
    const topActions = commentResp.actions as Array<Record<string, unknown>> | undefined
    if (Array.isArray(topActions)) {
      for (const a of topActions) {
        const errMsg = dig(a, 'showErrorAction', 'errorMessage', 'messageRenderer', 'text')
        const text = textRuns(errMsg) || (errMsg as { simpleText?: string } | undefined)?.simpleText
        if (text) throw errors.retriable(`YouTube rejected comment: ${text}`)
      }
    }
    throw errors.retriable('Could not extract created commentId from create_comment response')
  }

  return { videoId, commentId, text, author: '' }
}

// --- deleteComment ---
const deleteComment: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  const commentId = String(params.commentId || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!commentId) throw errors.missingParam('commentId')

  if (!page.url().includes(`watch?v=${videoId}`)) {
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1500)
  }

  const config = await getYtConfig(page)
  const context = makeContext(config)

  // InnerTube uses perform_comment_action with an encoded action string.
  // The action is: CAYaJ" + base64(commentId action proto)
  // Simpler approach: use the action endpoint directly with the comment external ID.
  await innertubeAuthPost(
    helpers, page, 'comment/perform_comment_action',
    { context, actions: ['action_remove_comment'], commentId },
    config,
  )

  return { videoId, commentId, deleted: true }
}

// --- getTranscript ---
const getTranscript: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  // Navigate to the video page to get player response with caption tracks
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  if (!page.url().includes(`watch?v=${videoId}`)) {
    await page.goto(videoUrl, { waitUntil: 'load', timeout: 15000 })
    await page.waitForTimeout(2000)
  }

  // Extract caption track URLs from ytInitialPlayerResponse
  const captionData = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    const player = w.ytInitialPlayerResponse as Record<string, unknown> | undefined
    if (!player) return null
    const captions = player.captions as Record<string, unknown> | undefined
    const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined
    if (!renderer) return null
    const tracks = renderer.captionTracks as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(tracks) || tracks.length === 0) return null
    return tracks.map(t => ({
      baseUrl: String(t.baseUrl || ''),
      languageCode: String(t.languageCode || ''),
      kind: String(t.kind || ''),
    }))
  })

  if (!captionData || captionData.length === 0) {
    return { videoId, segments: [], note: 'No transcript available for this video' }
  }

  // Select best track: prefer manual captions, then first available
  const lang = String(params.lang || '')
  let track = captionData[0]
  if (lang) {
    const exact = captionData.find(t => t.languageCode === lang)
    if (exact) track = exact
  } else {
    const manual = captionData.find(t => t.kind !== 'asr')
    if (manual) track = manual
  }

  // Fetch the timedtext via browser navigation (not fetch API — avoids bot detection)
  const separator = track.baseUrl.includes('?') ? '&' : '?'
  const timedTextUrl = `${track.baseUrl}${separator}fmt=json3`
  await page.goto(timedTextUrl, { waitUntil: 'load', timeout: 15000 })
  const rawContent = await page.evaluate(() => document.body?.innerText || '')

  if (!rawContent.trim()) {
    return { videoId, segments: [], note: 'Timedtext endpoint returned empty response' }
  }

  let timedText: Record<string, unknown>
  try {
    timedText = JSON.parse(rawContent) as Record<string, unknown>
  } catch {
    throw errors.fatal('YouTube timedtext returned invalid JSON')
  }

  // Parse JSON3 events into segments
  const events = timedText.events as Array<Record<string, unknown>> | undefined
  const segments: Array<Record<string, unknown>> = []
  if (Array.isArray(events)) {
    for (const event of events) {
      const segs = event.segs as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(segs)) continue
      const text = segs.map(s => String(s.utf8 || '')).join('')
      if (!text.trim()) continue
      const startMs = Number(event.tStartMs || 0)
      const durationMs = Number(event.dDurationMs || 0)
      segments.push({
        startMs: String(startMs),
        endMs: String(startMs + durationMs),
        text: text.trim(),
      })
    }
  }

  return {
    videoId,
    languageCode: track.languageCode,
    isAutoGenerated: track.kind === 'asr',
    segments,
  }
}

// --- likeVideo / unlikeVideo ---
const likeVideo: Handler = async (page, params, helpers) => {
  const videoId = String(params.videoId || '')
  if (!videoId) throw helpers.errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config)
  return innertubeAuthPost(helpers, page, 'like/like', { context, target: { videoId } }, config)
}

const unlikeVideo: Handler = async (page, params, helpers) => {
  const videoId = String(params.videoId || '')
  if (!videoId) throw helpers.errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config)
  return innertubeAuthPost(helpers, page, 'like/removelike', { context, target: { videoId } }, config)
}

// --- subscribeChannel / unsubscribeChannel ---
function extractChannelIds(params: Readonly<Record<string, unknown>>, errors: Errors): string[] {
  const raw = params.channelIds
  const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean) : []
  if (!ids.length) throw errors.missingParam('channelIds')
  return ids
}

const subscribeChannel: Handler = async (page, params, helpers) => {
  const channelIds = extractChannelIds(params, helpers.errors)
  const config = await getYtConfig(page)
  const context = makeContext(config)
  return innertubeAuthPost(helpers, page, 'subscription/subscribe', { context, channelIds }, config)
}

const unsubscribeChannel: Handler = async (page, params, helpers) => {
  const channelIds = extractChannelIds(params, helpers.errors)
  const config = await getYtConfig(page)
  const context = makeContext(config)
  return innertubeAuthPost(helpers, page, 'subscription/unsubscribe', { context, channelIds }, config)
}

const OPERATIONS: Record<string, Handler> = {
  getComments,
  getPlaylist,
  addComment,
  deleteComment,
  getTranscript,
  likeVideo,
  unlikeVideo,
  subscribeChannel,
  unsubscribeChannel,
}

const runner: CustomRunner = {
  name: 'youtube-innertube',
  description: 'YouTube — comments and playlist composition via InnerTube API',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('youtube-innertube requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
