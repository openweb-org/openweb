import type { Page } from 'patchright'
import type { PageFetchOptions, PageFetchResult } from '../../../lib/adapter-helpers.js'

/**
 * YouTube L2 adapter — composes InnerTube API calls for multi-step operations.
 *
 * getComments: two-step — fetch video next page for comment continuation token,
 * then fetch comments via continuation. getPlaylist: wraps /browse with VL-prefixed
 * browseId for a cleaner playlistId-based interface.
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

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, helpers: { errors: Errors; pageFetch: PageFetchFn }) => Promise<unknown>
> = {
  getComments,
  getPlaylist,
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
