import { createHash } from 'node:crypto'
import type { Page } from 'patchright'
import type { PageFetchOptions, PageFetchResult } from '../../../lib/adapter-helpers.js'

/**
 * YouTube L2 adapter — composes InnerTube API calls for multi-step operations.
 *
 * getComments: two-step — fetch video next page for comment continuation token,
 * then fetch comments via continuation. getPlaylist: wraps /browse with VL-prefixed
 * browseId for a cleaner playlistId-based interface. likeVideo/unlikeVideo: authenticated
 * InnerTube calls with sapisidhash signing.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type PageFetchFn = (page: Page, options: PageFetchOptions) => Promise<PageFetchResult>

const API_BASE = 'https://www.youtube.com/youtubei/v1'
const DEFAULT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const DEFAULT_CLIENT_VERSION = '2.20260325.08.00'

interface YtConfig {
  key: string
  clientVersion: string
}

async function getYtConfig(page: Page): Promise<YtConfig> {
  try {
    const config = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      const ytcfg = w.ytcfg as Record<string, unknown> | undefined
      if (!ytcfg) return null
      const data = (ytcfg.data_ || ytcfg.d) as Record<string, string> | undefined
      if (!data) return null
      return {
        key: data.INNERTUBE_API_KEY || '',
        clientVersion: data.INNERTUBE_CLIENT_VERSION || '',
      }
    })
    if (config?.key && config?.clientVersion) return config
  } catch { /* page may not have ytcfg loaded */ }
  return { key: DEFAULT_KEY, clientVersion: DEFAULT_CLIENT_VERSION }
}

function makeContext(clientVersion: string) {
  return { client: { clientName: 'WEB', clientVersion } }
}

/** Compute SAPISIDHASH for YouTube authenticated requests. */
function computeSapisidhash(sapisid: string, origin: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const hash = createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex')
  return `SAPISIDHASH ${timestamp}_${hash}`
}

/** Get SAPISID cookie from browser context for authenticated requests. */
async function getSapisidAuth(page: Page): Promise<string | undefined> {
  try {
    const cookies = await page.context().cookies('https://www.youtube.com')
    const sapisid = cookies.find(c => c.name === 'SAPISID')
    if (!sapisid) return undefined
    return computeSapisidhash(sapisid.value, 'https://www.youtube.com')
  } catch {
    return undefined
  }
}

async function innertubePost(
  pageFetch: PageFetchFn,
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
  config: YtConfig,
  errors: Errors,
): Promise<unknown> {
  const url = `${API_BASE}/${endpoint}?key=${config.key}&prettyPrint=false`
  const result = await pageFetch(page, {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (result.status >= 400) {
    throw errors.retriable(`InnerTube ${endpoint} returned HTTP ${result.status}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.fatal(`InnerTube ${endpoint} returned invalid JSON`)
  }
}

/** Authenticated InnerTube POST — includes sapisidhash Authorization header. */
async function innertubeAuthPost(
  pageFetch: PageFetchFn,
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
  config: YtConfig,
  errors: Errors,
): Promise<unknown> {
  const auth = await getSapisidAuth(page)
  if (!auth) {
    throw errors.fatal('Not logged in to YouTube — SAPISID cookie not found')
  }
  const url = `${API_BASE}/${endpoint}?key=${config.key}&prettyPrint=false`
  const result = await pageFetch(page, {
    url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': auth,
      'x-goog-authuser': '0',
      'x-origin': 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
  })
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

// --- getComments ---
async function getComments(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)

  // Step 1: get the comment section continuation token from /next
  const nextResp = await innertubePost(pageFetch, page, 'next', { context, videoId }, config, errors) as Record<string, unknown>

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
    pageFetch, page, 'next', { context, continuation: continuationToken }, config, errors,
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
async function getPlaylist(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const playlistId = String(params.playlistId || '')
  if (!playlistId) throw errors.missingParam('playlistId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)
  const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`

  const resp = await innertubePost(
    pageFetch, page, 'browse', { context, browseId }, config, errors,
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
async function addComment(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  const text = String(params.text || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!text) throw errors.missingParam('text')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)

  // Step 1: get createCommentParams from /next (comment creation token)
  const nextResp = await innertubePost(pageFetch, page, 'next', { context, videoId }, config, errors) as Record<string, unknown>

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

  // Step 2: post the comment via /comment/create_comment
  const commentResp = await innertubePost(
    pageFetch, page, 'comment/create_comment',
    { context, createCommentParams: createParams, commentText: text },
    config, errors,
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

  return { videoId, commentId, text, author: '' }
}

// --- deleteComment ---
async function deleteComment(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  const commentId = String(params.commentId || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!commentId) throw errors.missingParam('commentId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)

  // InnerTube uses perform_comment_action with an encoded action string.
  // The action is: CAYaJ" + base64(commentId action proto)
  // Simpler approach: use the action endpoint directly with the comment external ID.
  await innertubePost(
    pageFetch, page, 'comment/perform_comment_action',
    { context, actions: ['action_remove_comment'], commentId },
    config, errors,
  )

  return { videoId, commentId, deleted: true }
}

// --- getTranscript ---
async function getTranscript(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)

  // Step 1: get transcript params token from /next engagement panels
  const nextResp = await innertubePost(pageFetch, page, 'next', { context, videoId }, config, errors) as Record<string, unknown>

  const panels = nextResp.engagementPanels as Array<Record<string, unknown>> | undefined
  let transcriptParams: string | undefined
  if (Array.isArray(panels)) {
    for (const panel of panels) {
      const renderer = panel.engagementPanelSectionListRenderer as Record<string, unknown> | undefined
      if (!renderer || renderer.panelIdentifier !== 'engagement-panel-searchable-transcript') continue
      const continuation = dig(
        renderer,
        'content', 'continuationItemRenderer', 'continuationEndpoint', 'getTranscriptEndpoint', 'params',
      ) as string | undefined
      if (continuation) { transcriptParams = continuation; break }
    }
  }

  if (!transcriptParams) {
    return { videoId, segments: [], note: 'No transcript available for this video' }
  }

  // Step 2: fetch transcript (needs authenticated session to avoid FAILED_PRECONDITION)
  const auth = await getSapisidAuth(page)
  const transcriptHeaders: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) {
    transcriptHeaders.authorization = auth
    transcriptHeaders['x-goog-authuser'] = '0'
    transcriptHeaders['x-origin'] = 'https://www.youtube.com'
  }
  const transcriptUrl = `${API_BASE}/get_transcript?key=${config.key}&prettyPrint=false`
  const transcriptResult = await pageFetch(page, {
    url: transcriptUrl,
    method: 'POST',
    headers: transcriptHeaders,
    body: JSON.stringify({ context, params: transcriptParams }),
  })
  if (transcriptResult.status >= 400) {
    throw errors.retriable(`InnerTube get_transcript returned HTTP ${transcriptResult.status}`)
  }
  let transcriptResp: Record<string, unknown>
  try {
    transcriptResp = JSON.parse(transcriptResult.text) as Record<string, unknown>
  } catch {
    throw errors.fatal('InnerTube get_transcript returned invalid JSON')
  }

  // Parse transcript segments from response
  const segments: Array<Record<string, unknown>> = []
  const actions = transcriptResp.actions as Array<Record<string, unknown>> | undefined
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const body = dig(action, 'updateEngagementPanelAction', 'content',
        'transcriptRenderer', 'content', 'transcriptSearchPanelRenderer',
        'body', 'transcriptSegmentListRenderer', 'initialSegments',
      ) as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(body)) continue
      for (const seg of body) {
        const renderer = seg.transcriptSegmentRenderer as Record<string, unknown> | undefined
        if (!renderer) continue
        segments.push({
          startMs: renderer.startMs || '',
          endMs: renderer.endMs || '',
          text: textRuns(renderer.snippet),
        })
      }
    }
  }

  return { videoId, segments }
}

// --- likeVideo / unlikeVideo ---
async function likeVideo(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)
  return innertubeAuthPost(pageFetch, page, 'like/like', { context, target: { videoId } }, config, errors)
}

async function unlikeVideo(
  page: Page,
  params: Record<string, unknown>,
  helpers: { errors: Errors; pageFetch: PageFetchFn },
): Promise<unknown> {
  const { errors, pageFetch } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config.clientVersion)
  return innertubeAuthPost(pageFetch, page, 'like/removelike', { context, target: { videoId } }, config, errors)
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, helpers: { errors: Errors; pageFetch: PageFetchFn }) => Promise<unknown>
> = {
  getComments,
  getPlaylist,
  addComment,
  deleteComment,
  getTranscript,
  likeVideo,
  unlikeVideo,
}

const adapter = {
  name: 'youtube-innertube',
  description: 'YouTube — comments and playlist composition via InnerTube API',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('youtube.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Both operations work without auth
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
