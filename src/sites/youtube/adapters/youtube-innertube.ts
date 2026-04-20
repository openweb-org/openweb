import { createHash } from 'node:crypto'
import type { Page, Response as PwResponse } from 'patchright'

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

// --- intercept helper (dispatch-events pattern) ---
//
// JS fetch (even page.evaluate(fetch)) cannot replay YouTube's write APIs:
// Chrome's anti-abuse layer compares sec-fetch-mode + the TLS-bound
// x-browser-validation header against the SPA-initiated origin. Only requests
// that originate from real Chrome UI events pass. We drive the SPA's own UI
// and intercept the response off the wire — same approach as chatgpt-web.ts.
function captureResponse(page: Page, urlMatch: RegExp): {
  wait: (timeoutMs: number) => Promise<unknown>
  off: () => void
} {
  let bodyPromise: Promise<unknown> | null = null
  const handler = (resp: PwResponse) => {
    if (bodyPromise) return
    if (resp.request().method() !== 'POST') return
    if (!urlMatch.test(resp.url())) return
    bodyPromise = resp.json().catch(() => resp.text().catch(() => null))
  }
  page.on('response', handler)
  return {
    wait: async (timeoutMs) => {
      const start = Date.now()
      while (!bodyPromise && Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, 200))
      }
      return bodyPromise
    },
    off: () => page.off('response', handler),
  }
}

async function ensureWatchPage(page: Page, videoId: string): Promise<void> {
  if (page.url().includes(`watch?v=${videoId}`)) return
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(1500)
}

function deepFindString(root: unknown, regex: RegExp): string {
  const stack: unknown[] = [root]
  while (stack.length) {
    const cur = stack.pop()
    if (typeof cur === 'string') {
      if (regex.test(cur)) return cur
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v)
    } else if (cur && typeof cur === 'object') {
      for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v)
    }
  }
  return ''
}

// --- addComment (dispatch-events + passive intercept) ---
const addComment: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  const text = String(params.text || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!text) throw errors.missingParam('text')

  await ensureWatchPage(page, videoId)

  // Comments lazy-load — must scroll into view before the section renders.
  await page.evaluate(() => window.scrollTo(0, 700))
  await page.waitForSelector('ytd-comments #placeholder-area', { timeout: 20_000 })

  const cap = captureResponse(page, /\/youtubei\/v1\/comment\/create_comment(?:\?|$)/)
  try {
    await page.click('ytd-comments #placeholder-area')
    await page.waitForSelector('ytd-commentbox #contenteditable-root', { timeout: 10_000, state: 'attached' })
    // Composer is a contenteditable — must use real keyboard events
    await page.locator('ytd-commentbox #contenteditable-root').first().focus()
    await page.keyboard.type(text)
    // Submit button is rendered hidden until the editor has content; click via JS
    // because the visible-state heuristic is unreliable across YT's button shells.
    await page.waitForFunction(() => {
      const btn = document.querySelector('ytd-commentbox button[aria-label="Comment"]') as HTMLButtonElement | null
      return btn && btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled
    }, { timeout: 5_000 })
    await page.evaluate(() => {
      const btn = document.querySelector('ytd-commentbox button[aria-label="Comment"]') as HTMLButtonElement | null
      btn?.click()
    })

    const body = await cap.wait(20_000) as Record<string, unknown> | null
    if (!body) throw errors.retriable('No /comment/create_comment response within timeout')

    // Surface YT spam-filter rejection if present
    const topActions = body.actions as Array<Record<string, unknown>> | undefined
    if (Array.isArray(topActions)) {
      for (const a of topActions) {
        const errMsg = dig(a, 'showErrorAction', 'errorMessage', 'messageRenderer', 'text')
        const t = textRuns(errMsg) || (errMsg as { simpleText?: string } | undefined)?.simpleText
        if (t) throw errors.retriable(`YouTube rejected comment: ${t}`)
      }
    }

    // The commentId returned in actionResults.key is an internal action ID,
    // not the URL-form Ug... ID we need for deleteComment. The SPA renders
    // the new comment optimistically at the top of the list — read its
    // commentId from the DOM. Wait up to 10s for the optimistic render.
    let commentId = ''
    const start = Date.now()
    while (!commentId && Date.now() - start < 10_000) {
      commentId = await page.evaluate((needle) => {
        const threads = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
        for (const t of threads) {
          const content = t.querySelector('#content-text')?.textContent?.trim() || ''
          if (!content.includes(needle)) continue
          const m = (t as HTMLElement).outerHTML.match(/Ug[\w-]{18,30}/)
          if (m) return m[0]
        }
        return ''
      }, text.slice(0, 80))
      if (!commentId) await page.waitForTimeout(500)
    }
    if (!commentId) {
      // Fallback: take the response's first Ug... string even if non-canonical
      commentId = deepFindString(body, /^Ug[\w-]{10,}/)
    }
    if (!commentId) throw errors.retriable('Could not extract commentId — comment may not have rendered yet')
    return { videoId, commentId, text, author: '' }
  } finally {
    cap.off()
  }
}

// --- deleteComment (dispatch-events + passive intercept) ---
const deleteComment: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  const commentId = String(params.commentId || '')
  if (!videoId) throw errors.missingParam('videoId')
  if (!commentId) throw errors.missingParam('commentId')

  // Use YT's `lc=` deep-link — it pins the target comment to the top of the
  // section regardless of pagination/sort, so we don't have to hunt for it.
  await page.goto(`https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.scrollTo(0, 700))
  await page.waitForSelector('ytd-comments ytd-comment-thread-renderer', { timeout: 20_000 })

  // Newly-posted comments may not appear immediately — poll for the target
  // commentId, scrolling further as needed to trigger pagination. Skip pinned
  // comments (the creator's pinned comment is rendered first and matches
  // unrelated outerHTML strings); prefer non-pinned threads whose ytd-comment-view-model
  // contains the commentId.
  let thread: Awaited<ReturnType<Page['$']>> = null
  const findStart = Date.now()
  while (Date.now() - findStart < 20_000) {
    const handle = await page.evaluateHandle((id) => {
      const threads = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
      // First pass: thread whose comment-view-model is NOT pinned and whose outerHTML contains id
      let match = threads.find(t => {
        const view = t.querySelector('ytd-comment-view-model')
        if (!view) return false
        if (view.hasAttribute('pinned')) return false
        return (t as HTMLElement).outerHTML.includes(id)
      })
      // Fallback: any thread containing the id
      if (!match) match = threads.find(t => (t as HTMLElement).outerHTML.includes(id))
      if (match) (match as HTMLElement).scrollIntoView({ block: 'center' })
      return match || null
    }, commentId)
    const el = handle.asElement()
    if (el) { thread = el as unknown as Awaited<ReturnType<Page['$']>>; break }
    await page.waitForTimeout(500)
  }
  if (!thread) throw errors.retriable(`Comment ${commentId} not in rendered list after wait`)

  const cap = captureResponse(page, /\/youtubei\/v1\/comment\/perform_comment_action(?:\?|$)/)
  try {
    await thread.hover()
    const kebab = await thread.$('#action-menu button, ytd-menu-renderer button, button[aria-label*="ction menu" i]')
    if (!kebab) throw errors.retriable('Kebab menu button not found on comment')
    await kebab.click()

    await page.waitForSelector(
      'ytd-menu-popup-renderer ytd-menu-service-item-renderer, tp-yt-paper-listbox ytd-menu-service-item-renderer',
      { timeout: 5_000 },
    )
    const clickedDelete = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(
        'ytd-menu-popup-renderer ytd-menu-service-item-renderer, tp-yt-paper-listbox ytd-menu-service-item-renderer',
      ))
      const del = items.find(i => /^\s*delete\s*$/i.test((i.textContent || '').trim()))
      if (!del) return false
      ;(del as HTMLElement).click()
      return true
    })
    if (!clickedDelete) throw errors.retriable('Delete menu item not found')

    await page.waitForSelector('yt-confirm-dialog-renderer, tp-yt-paper-dialog', { timeout: 5_000 })
    const clickedConfirm = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('yt-confirm-dialog-renderer #confirm-button button'),
        ...document.querySelectorAll('tp-yt-paper-dialog button'),
      ]
      const btn = (candidates.find(b => /delete/i.test((b.textContent || '').trim())) || candidates[0]) as HTMLElement | undefined
      if (!btn) return false
      btn.click()
      return true
    })
    if (!clickedConfirm) throw errors.retriable('Confirm-delete button not found')

    const body = await cap.wait(15_000)
    if (!body) throw errors.retriable('No /perform_comment_action response within timeout')
    return { videoId, commentId, deleted: true }
  } finally {
    cap.off()
  }
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

// --- likeVideo / unlikeVideo (dispatch-events + passive intercept) ---
//
// The like button is a toggle. We click it and intercept whichever of
// /like/like or /like/removelike fires. Caller asks for "like" — if the
// video was already liked (button shows pressed), the click would un-like
// it; we detect and re-click so the resulting state matches the request.
async function clickLikeAndCapture(
  page: Page,
  videoId: string,
  desired: 'like' | 'unlike',
  helpers: AdapterHelpers,
): Promise<unknown> {
  const { errors } = helpers
  await ensureWatchPage(page, videoId)
  const likeSel = 'like-button-view-model button[aria-label*="ike this video" i]'
  await page.waitForSelector(likeSel, { timeout: 20_000, state: 'attached' })

  const cap = captureResponse(page, /\/youtubei\/v1\/like\/(like|removelike)(?:\?|$)/)
  try {
    // Read pressed state to decide whether to click once or twice (toggle semantics)
    const isLiked = await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement | null
      if (!btn) return false
      return btn.getAttribute('aria-pressed') === 'true'
    }, likeSel)
    const wantLiked = desired === 'like'
    if (isLiked === wantLiked) {
      // Already in desired state; nothing to intercept. Return synthetic success.
      return { videoId, [desired === 'like' ? 'liked' : 'unliked']: true, noop: true }
    }
    await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement | null
      btn?.click()
    }, likeSel)
    const body = await cap.wait(15_000)
    if (!body) throw errors.retriable(`No /like/${desired === 'like' ? 'like' : 'removelike'} response within timeout`)
    return body
  } finally {
    cap.off()
  }
}

const likeVideo: Handler = async (page, params, helpers) => {
  const videoId = String(params.videoId || '')
  if (!videoId) throw helpers.errors.missingParam('videoId')
  return clickLikeAndCapture(page, videoId, 'like', helpers)
}

const unlikeVideo: Handler = async (page, params, helpers) => {
  const videoId = String(params.videoId || '')
  if (!videoId) throw helpers.errors.missingParam('videoId')
  return clickLikeAndCapture(page, videoId, 'unlike', helpers)
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
