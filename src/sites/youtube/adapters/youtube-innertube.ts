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

  // Parse playlist metadata — YouTube replaced playlistHeaderRenderer with
  // pageHeaderRenderer (2025+). Primary data now lives in the sidebar's
  // playlistSidebarPrimaryInfoRenderer and metadata.playlistMetadataRenderer.
  const sidebarItems = dig(resp, 'sidebar', 'playlistSidebarRenderer', 'items') as Array<Record<string, unknown>> | undefined
  const primaryInfo = sidebarItems?.[0]?.playlistSidebarPrimaryInfoRenderer as Record<string, unknown> | undefined
  const secondaryInfo = sidebarItems?.[1]?.playlistSidebarSecondaryInfoRenderer as Record<string, unknown> | undefined
  const metadataRenderer = dig(resp, 'metadata', 'playlistMetadataRenderer') as Record<string, unknown> | undefined

  const title = textRuns(primaryInfo?.title) || (metadataRenderer?.title as string) || ''
  const description = textRuns(primaryInfo?.description) || (metadataRenderer?.description as string) || ''
  const ownerName = textRuns(dig(secondaryInfo, 'videoOwner', 'videoOwnerRenderer', 'title'))
  const stats = (primaryInfo?.stats as Array<unknown> | undefined)?.map(textRuns) || []
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

  // Comments are lazy-loaded — scroll the <ytd-comments> container into view
  // (layout-independent) to trigger hydration of the placeholder + thread list.
  await page.waitForSelector('ytd-comments', { timeout: 15_000, state: 'attached' })
  await page.evaluate(() => document.querySelector('ytd-comments')?.scrollIntoView({ block: 'start' }))
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

    // Canonical commentId source: the response's
    // frameworkUpdates.entityBatchUpdate.mutations[].payload.commentEntityPayload.properties.commentId
    // — proved via probe to match the DOM's `<a href="...&lc=<id>">` anchor
    // exactly (this is the URL form that lc= deep-link recognizes). Earlier
    // attempts at `actionResults[0].key` failed because that field is undefined
    // on this endpoint shape.
    let commentId = ''
    const mutations = dig(body, 'frameworkUpdates', 'entityBatchUpdate', 'mutations') as Array<Record<string, unknown>> | undefined
    if (Array.isArray(mutations)) {
      for (const m of mutations) {
        const props = dig(m, 'payload', 'commentEntityPayload', 'properties') as Record<string, unknown> | undefined
        if (props?.commentId) { commentId = String(props.commentId); break }
      }
    }
    // Fallback: read from the SPA's optimistic DOM render (anchor href).
    if (!commentId) {
      const start = Date.now()
      while (!commentId && Date.now() - start < 5_000) {
        commentId = await page.evaluate((needle) => {
          const threads = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
          for (const t of threads) {
            const content = t.querySelector('#content-text')?.textContent?.trim() || ''
            if (!content.includes(needle)) continue
            const anchor = t.querySelector('a[href*="lc="]')
            const m = (anchor?.getAttribute('href') || '').match(/[?&]lc=([^&]+)/)
            if (m) return m[1]
          }
          return ''
        }, text.slice(0, 80))
        if (!commentId) await page.waitForTimeout(500)
      }
    }
    if (!commentId) throw errors.retriable('Could not extract commentId from create_comment response or DOM')
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

  // YT's `lc=<commentId>` pins the comment to the top — but the comments
  // section is lazy-loaded on scroll, so a single scrollIntoView on the
  // <ytd-comments> container is required to trigger hydration. (Earlier code
  // used `scrollTo(0, 700)` which fell short of the comments section on this
  // layout — anchored scrollIntoView is layout-independent.)
  await page.goto(`https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('ytd-comments', { timeout: 15_000, state: 'attached' })
  // Scroll the comments container into view to trigger lazy-hydration. Use
  // both scrollIntoView (layout-independent) and a window scroll to handle
  // virtualized layouts where the container itself is offscreen.
  await page.evaluate(() => {
    const c = document.querySelector('ytd-comments') as HTMLElement | null
    c?.scrollIntoView({ block: 'start' })
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const c = document.querySelector('ytd-comments') as HTMLElement | null
    if (c) {
      const y = c.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, Math.max(0, y - 80))
    }
  })
  await page.waitForSelector('ytd-comments ytd-comment-thread-renderer', { timeout: 25_000, state: 'attached' })

  // Match by canonical lc= anchor (the form addComment now returns and getComments
  // exposes); fall back to outerHTML substring for safety.
  let thread: Awaited<ReturnType<Page['$']>> = null
  const findStart = Date.now()
  while (Date.now() - findStart < 20_000) {
    const handle = await page.evaluateHandle((id) => {
      const threads = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
      const byAnchor = threads.find(t => Array.from(t.querySelectorAll('a[href*="lc="]')).some(a => (a.getAttribute('href') || '').includes(`lc=${id}`)))
      const match = byAnchor || threads.find(t => (t as HTMLElement).outerHTML.includes(id))
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

    // Own-comment menu uses `ytd-menu-navigation-item-renderer` (Edit / Delete);
    // others'-comment menu uses `ytd-menu-service-item-renderer` (Report). The
    // popup renders with max-height: 0 initially so visibility checks fail —
    // use state: 'attached'.
    await page.waitForSelector(
      'ytd-menu-popup-renderer ytd-menu-navigation-item-renderer, ytd-menu-popup-renderer ytd-menu-service-item-renderer',
      { timeout: 5_000, state: 'attached' },
    )
    // Use Playwright's real click on the inner <a> element — JS .click() on
    // the wrapper renderer does not trigger YT's polymer handler (the confirm
    // dialog never opens). Probed and verified.
    const delHandle = await page.evaluateHandle(() => {
      const items = Array.from(document.querySelectorAll('ytd-menu-popup-renderer ytd-menu-navigation-item-renderer, ytd-menu-popup-renderer ytd-menu-service-item-renderer'))
      const del = items.find(i => /^\s*delete\s*$/i.test((i.textContent || '').trim()))
      return del?.querySelector('a') || del || null
    })
    const delEl = delHandle.asElement()
    if (!delEl) throw errors.retriable('Delete menu item not found')
    await delEl.click()

    await page.waitForSelector('yt-confirm-dialog-renderer, tp-yt-paper-dialog', { timeout: 5_000, state: 'attached' })
    // Use Playwright click on the confirm button (same reason as Delete item:
    // JS .click() doesn't trigger YT's polymer handler reliably).
    const confirmHandle = await page.evaluateHandle(() => {
      const candidates = [
        ...document.querySelectorAll('yt-confirm-dialog-renderer #confirm-button button'),
        ...document.querySelectorAll('tp-yt-paper-dialog button'),
      ]
      return (candidates.find(b => /delete/i.test((b.textContent || '').trim())) || candidates[0]) || null
    })
    const confirmEl = confirmHandle.asElement()
    if (!confirmEl) throw errors.retriable('Confirm-delete button not found')
    await confirmEl.click()

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

  const config = await getYtConfig(page)
  const context = makeContext(config)

  // Step 1: get transcript params token from the video detail engagement panels
  const nextResp = await innertubePost(helpers, page, 'next', { context, videoId }, config) as Record<string, unknown>
  const panels = nextResp.engagementPanels as Array<Record<string, unknown>> | undefined
  let transcriptParams = ''
  if (Array.isArray(panels)) {
    for (const p of panels) {
      const id = dig(p, 'engagementPanelSectionListRenderer', 'panelIdentifier')
      if (id !== 'engagement-panel-searchable-transcript') continue
      transcriptParams = dig(p, 'engagementPanelSectionListRenderer', 'content', 'continuationItemRenderer', 'continuationEndpoint', 'getTranscriptEndpoint', 'params') as string || ''
      break
    }
  }

  if (!transcriptParams) {
    return { videoId, segments: [], note: 'No transcript available for this video' }
  }

  // Step 2: fetch transcript via get_transcript endpoint
  let transcriptResp: Record<string, unknown>
  try {
    transcriptResp = await innertubePost(helpers, page, 'get_transcript', { context, params: transcriptParams }, config) as Record<string, unknown>
  } catch {
    return { videoId, segments: [], note: 'Transcript fetch failed — endpoint may require browser session context' }
  }

  // Parse transcript from the response
  const body = dig(transcriptResp, 'actions', '0', 'updateEngagementPanelAction', 'content', 'transcriptRenderer', 'body', 'transcriptBodyRenderer') as Record<string, unknown> | undefined
  const cueGroups = body?.cueGroups as Array<Record<string, unknown>> | undefined
  const segments: Array<Record<string, unknown>> = []

  if (Array.isArray(cueGroups)) {
    for (const group of cueGroups) {
      const cues = dig(group, 'transcriptCueGroupRenderer', 'cues') as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(cues)) continue
      for (const cue of cues) {
        const renderer = cue.transcriptCueRenderer as Record<string, unknown> | undefined
        if (!renderer) continue
        const text = textRuns(renderer.cue) || (renderer.cue as Record<string, unknown>)?.simpleText as string || ''
        if (!text.trim()) continue
        segments.push({
          startMs: String(renderer.startOffsetMs || '0'),
          endMs: String(Number(renderer.startOffsetMs || 0) + Number(renderer.durationMs || 0)),
          text: text.trim(),
        })
      }
    }
  }

  // Detect language from transcript header
  const header = dig(transcriptResp, 'actions', '0', 'updateEngagementPanelAction', 'content', 'transcriptRenderer', 'header', 'transcriptHeaderRenderer') as Record<string, unknown> | undefined
  const langMenu = dig(header, 'languageMenu', 'sortFilterSubMenuRenderer', 'subMenuItems') as Array<Record<string, unknown>> | undefined
  let languageCode = ''
  if (Array.isArray(langMenu)) {
    const selected = langMenu.find(i => i.selected)
    if (selected) languageCode = textRuns(selected.title) || (selected.title as string) || ''
  }

  const lang = String(params.lang || '')

  return {
    videoId,
    languageCode: languageCode || lang || 'en',
    isAutoGenerated: languageCode.toLowerCase().includes('auto'),
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

// --- response trim helpers ---
function trimVideoRenderer(v: Record<string, unknown>): Record<string, unknown> {
  return {
    videoId: v.videoId || '',
    title: textRuns(v.title),
    channelName: textRuns(v.longBylineText || v.shortBylineText || v.ownerText),
    channelId: dig(v, 'longBylineText', 'runs', '0', 'navigationEndpoint', 'browseEndpoint', 'browseId') || '',
    viewCount: textRuns(v.viewCountText),
    duration: textRuns(v.lengthText),
    publishedTime: textRuns(v.publishedTimeText),
    thumbnail: dig(v, 'thumbnail', 'thumbnails', '0', 'url') || '',
    description: textRuns(v.detailedMetadataSnippets?.[0]
      ? (v.detailedMetadataSnippets as Array<Record<string, unknown>>)[0].snippetText
      : v.descriptionSnippet),
  }
}

function trimRichItem(item: Record<string, unknown>): Record<string, unknown> | null {
  const v = dig(item, 'richItemRenderer', 'content', 'videoRenderer') as Record<string, unknown> | undefined
  if (v) return trimVideoRenderer(v)
  const shorts = dig(item, 'richItemRenderer', 'content', 'reelItemRenderer') as Record<string, unknown> | undefined
  if (shorts) return { videoId: shorts.videoId || '', title: textRuns(shorts.headline), type: 'short' }
  return null
}

// --- searchVideos ---
const searchVideos: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const query = String(params.query || '')
  if (!query) throw errors.missingParam('query')

  const config = await getYtConfig(page)
  const context = makeContext(config)
  const resp = await innertubePost(helpers, page, 'search', { context, query }, config) as Record<string, unknown>

  const estimatedResults = (resp.estimatedResults as string) || '0'
  const sections = dig(resp, 'contents', 'twoColumnSearchResultsRenderer', 'primaryContents', 'sectionListRenderer', 'contents') as Array<Record<string, unknown>> | undefined
  const results: Array<Record<string, unknown>> = []

  if (Array.isArray(sections)) {
    for (const section of sections) {
      const items = (section.itemSectionRenderer as Record<string, unknown> | undefined)?.contents as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (item.videoRenderer) {
          results.push(trimVideoRenderer(item.videoRenderer as Record<string, unknown>))
        } else if (item.playlistRenderer) {
          const p = item.playlistRenderer as Record<string, unknown>
          results.push({
            type: 'playlist',
            playlistId: p.playlistId || '',
            title: textRuns(p.title),
            videoCount: textRuns(p.videoCount || p.videoCountText),
            channelName: textRuns(p.longBylineText || p.shortBylineText),
            thumbnail: dig(p, 'thumbnails', '0', 'thumbnails', '0', 'url') || '',
          })
        } else if (item.channelRenderer) {
          const c = item.channelRenderer as Record<string, unknown>
          results.push({
            type: 'channel',
            channelId: c.channelId || '',
            title: textRuns(c.title),
            subscriberCount: textRuns(c.subscriberCountText),
            description: textRuns(c.descriptionSnippet),
            thumbnail: dig(c, 'thumbnail', 'thumbnails', '0', 'url') || '',
          })
        }
      }
    }
  }

  return { query, estimatedResults, results }
}

// --- getVideoDetail ---
const getVideoDetail: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  const config = await getYtConfig(page)
  const context = makeContext(config)
  const resp = await innertubePost(helpers, page, 'next', { context, videoId }, config) as Record<string, unknown>

  const resultContents = dig(resp, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents') as Array<Record<string, unknown>> | undefined

  let primaryInfo: Record<string, unknown> | undefined
  let secondaryInfo: Record<string, unknown> | undefined
  if (Array.isArray(resultContents)) {
    for (const item of resultContents) {
      if (item.videoPrimaryInfoRenderer) primaryInfo = item.videoPrimaryInfoRenderer as Record<string, unknown>
      if (item.videoSecondaryInfoRenderer) secondaryInfo = item.videoSecondaryInfoRenderer as Record<string, unknown>
    }
  }

  const title = textRuns(primaryInfo?.title)
  const viewCount = textRuns(dig(primaryInfo, 'viewCount', 'videoViewCountRenderer', 'viewCount'))
  const dateText = textRuns(primaryInfo?.dateText)
  const channelName = textRuns(dig(secondaryInfo, 'owner', 'videoOwnerRenderer', 'title'))
  const channelId = dig(secondaryInfo, 'owner', 'videoOwnerRenderer', 'navigationEndpoint', 'browseEndpoint', 'browseId') as string || ''
  const subscriberCount = textRuns(dig(secondaryInfo, 'owner', 'videoOwnerRenderer', 'subscriberCountText'))
  const description = (dig(secondaryInfo, 'attributedDescription', 'content') as string)
    || textRuns(dig(secondaryInfo, 'description'))

  // Like count from the menu buttons
  const topLevelButtons = dig(primaryInfo, 'videoActions', 'menuRenderer', 'topLevelButtons') as Array<Record<string, unknown>> | undefined
  let likeCount = ''
  if (Array.isArray(topLevelButtons)) {
    for (const btn of topLevelButtons) {
      const toggle = btn.segmentedLikeDislikeButtonViewModel || btn.toggleButtonRenderer
      if (!toggle) continue
      const likeText = dig(toggle, 'likeButtonViewModel', 'likeButtonViewModel', 'toggleButtonViewModel', 'toggleButtonViewModel', 'defaultButtonViewModel', 'buttonViewModel', 'title') as string
        || textRuns(dig(toggle, 'defaultText'))
      if (likeText) { likeCount = likeText; break }
    }
  }

  // Recommendations from secondary results — browser response wraps items in
  // itemSectionRenderer, while curl returns lockupViewModel items directly.
  const rawSecondaryItems = dig(resp, 'contents', 'twoColumnWatchNextResults', 'secondaryResults', 'secondaryResults', 'results') as Array<Record<string, unknown>> | undefined
  let recItems: Array<Record<string, unknown>> = []
  if (Array.isArray(rawSecondaryItems)) {
    for (const item of rawSecondaryItems) {
      if (item.lockupViewModel || item.compactVideoRenderer) {
        recItems.push(item)
      } else if (item.itemSectionRenderer) {
        const nested = (item.itemSectionRenderer as Record<string, unknown>).contents as Array<Record<string, unknown>> | undefined
        if (Array.isArray(nested)) recItems.push(...nested)
      }
    }
  }
  const recommendations: Array<Record<string, unknown>> = []
  for (const item of recItems.slice(0, 10)) {
    const lvm = item.lockupViewModel as Record<string, unknown> | undefined
    if (lvm) {
      const meta = dig(lvm, 'metadata', 'lockupMetadataViewModel') as Record<string, unknown> | undefined
      const metaRows = dig(meta, 'metadata', 'contentMetadataViewModel', 'metadataRows') as Array<Record<string, unknown>> | undefined
      const parts = metaRows?.flatMap(r => (r.metadataParts as Array<Record<string, unknown>> || [])) || []
      const partTexts = parts.map(p => (p.text as Record<string, unknown>)?.content as string || '')
      recommendations.push({
        videoId: lvm.contentId || '',
        title: (dig(meta, 'title', 'content') as string) || '',
        channelName: partTexts[0] || '',
        viewCount: partTexts[1] || '',
        duration: (dig(lvm, 'contentImage', 'thumbnailViewModel', 'overlays', '0', 'thumbnailBottomOverlayViewModel', 'badges', '0', 'thumbnailBadgeViewModel', 'text') as string) || '',
        thumbnail: (dig(lvm, 'contentImage', 'thumbnailViewModel', 'image', 'sources', '0', 'url') as string) || '',
      })
      continue
    }
    const cr = item.compactVideoRenderer as Record<string, unknown> | undefined
    if (!cr) continue
    recommendations.push({
      videoId: cr.videoId || '',
      title: textRuns(cr.title),
      channelName: textRuns(cr.longBylineText || cr.shortBylineText),
      viewCount: textRuns(cr.viewCountText),
      duration: textRuns(cr.lengthText),
      thumbnail: dig(cr, 'thumbnail', 'thumbnails', '0', 'url') || '',
    })
  }
  const panels = resp.engagementPanels as Array<Record<string, unknown>> | undefined
  let hasTranscript = false
  if (Array.isArray(panels)) {
    hasTranscript = panels.some(p =>
      dig(p, 'engagementPanelSectionListRenderer', 'panelIdentifier') === 'engagement-panel-searchable-transcript')
  }

  return {
    videoId,
    title,
    channelName,
    channelId,
    subscriberCount,
    viewCount,
    dateText,
    likeCount,
    description: description.slice(0, 2000),
    hasTranscript,
    recommendations,
  }
}

// --- browseContent ---
const browseContent: Handler = async (page, params, helpers) => {
  const { errors } = helpers
  const browseId = String(params.browseId || '')
  if (!browseId) throw errors.missingParam('browseId')

  if (browseId === 'FEtrending' || browseId === 'FEexplore') {
    throw errors.fatal('FEtrending/FEexplore browse IDs are no longer supported by YouTube. Use searchVideos with a topical query instead.')
  }

  const config = await getYtConfig(page)
  const context = makeContext(config)
  const body: Record<string, unknown> = { context, browseId }
  if (params.params) body.params = String(params.params)

  const resp = await innertubePost(helpers, page, 'browse', body, config) as Record<string, unknown>

  const metadata = resp.metadata as Record<string, unknown> | undefined
  const meta = metadata ? Object.values(metadata)[0] as Record<string, unknown> | undefined : undefined

  const tabs = dig(resp, 'contents', 'twoColumnBrowseResultsRenderer', 'tabs') as Array<Record<string, unknown>> | undefined
  const trimmedTabs: Array<Record<string, unknown>> = []

  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      const renderer = tab.tabRenderer as Record<string, unknown> | undefined
      if (!renderer) continue
      const tabTitle = textRuns(renderer.title) || (renderer.title as string) || ''
      const content = renderer.content as Record<string, unknown> | undefined
      if (!content) { trimmedTabs.push({ title: tabTitle, selected: !!renderer.selected }); continue }

      const videos: Array<Record<string, unknown>> = []

      // richGridRenderer (homepage, channel videos tab)
      const richGrid = content.richGridRenderer as Record<string, unknown> | undefined
      if (richGrid) {
        const gridItems = richGrid.contents as Array<Record<string, unknown>> | undefined
        if (Array.isArray(gridItems)) {
          for (const item of gridItems.slice(0, 50)) {
            const trimmed = trimRichItem(item)
            if (trimmed) videos.push(trimmed)
          }
        }
      }

      // sectionListRenderer (channel home, playlists)
      const sectionList = content.sectionListRenderer as Record<string, unknown> | undefined
      if (sectionList) {
        const sections = sectionList.contents as Array<Record<string, unknown>> | undefined
        if (Array.isArray(sections)) {
          for (const section of sections) {
            const shelf = dig(section, 'itemSectionRenderer', 'contents', '0', 'shelfRenderer') as Record<string, unknown> | undefined
            if (shelf) {
              const shelfItems = dig(shelf, 'content', 'horizontalListRenderer', 'items')
                || dig(shelf, 'content', 'expandedShelfContentsRenderer', 'items')
              if (Array.isArray(shelfItems)) {
                for (const item of (shelfItems as Array<Record<string, unknown>>).slice(0, 20)) {
                  const gr = item.gridVideoRenderer as Record<string, unknown> | undefined
                  if (gr) videos.push(trimVideoRenderer(gr))
                }
              }
            }
            // Direct video items in sections
            const sectionItems = dig(section, 'itemSectionRenderer', 'contents') as Array<Record<string, unknown>> | undefined
            if (Array.isArray(sectionItems)) {
              for (const item of sectionItems) {
                if (item.videoRenderer) videos.push(trimVideoRenderer(item.videoRenderer as Record<string, unknown>))
                if (item.gridVideoRenderer) videos.push(trimVideoRenderer(item.gridVideoRenderer as Record<string, unknown>))
              }
            }
          }
        }
      }

      trimmedTabs.push({ title: tabTitle, selected: !!renderer.selected, videos })
    }
  }

  return {
    browseId,
    title: (meta?.title as string) || textRuns(dig(resp, 'header', 'pageHeaderRenderer', 'pageTitle')) || '',
    description: (meta?.description as string) || '',
    tabs: trimmedTabs,
  }
}

const OPERATIONS: Record<string, Handler> = {
  searchVideos,
  getVideoDetail,
  browseContent,
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
  description: 'YouTube — search, detail, browse, comments, playlist, transcript via InnerTube API',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('youtube-innertube requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
