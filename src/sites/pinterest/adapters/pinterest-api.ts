import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

type R = Record<string, unknown>

const BASE = 'https://www.pinterest.com'

const PINTEREST_HEADERS: Record<string, string> = {
  'x-requested-with': 'XMLHttpRequest',
  'x-pinterest-appstate': 'active',
  accept: 'application/json, text/javascript, */*, q=0.01',
}

async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  return cookies.find(c => c.name === 'csrftoken')?.value || ''
}

async function pinterestGet(
  helpers: AdapterHelpers,
  page: Page,
  path: string,
  sourceUrl: string,
  data: string,
  pwsHandler = 'www/[...path].js',
): Promise<R> {
  const qs = new URLSearchParams({ source_url: sourceUrl, data }).toString()
  const url = `${BASE}${path}?${qs}`
  const headers: Record<string, string> = {
    ...PINTEREST_HEADERS,
    'x-pinterest-pws-handler': pwsHandler,
    'x-pinterest-source-url': sourceUrl,
  }
  const result = await helpers.pageFetch(page, { url, method: 'GET', headers, credentials: 'include' })
  if (result.status === 401 || result.status === 403) throw helpers.errors.needsLogin()
  if (result.status >= 400) throw helpers.errors.retriable(`Pinterest returned HTTP ${result.status}`)
  let body: unknown
  try { body = JSON.parse(result.text) } catch { throw helpers.errors.fatal('Response is not valid JSON') }
  const rr = (body as R).resource_response as R | undefined
  if (!rr) throw helpers.errors.fatal('Missing resource_response')
  if (rr.status !== 'success') {
    throw helpers.errors.retriable(`Pinterest API error: ${rr.message ?? rr.status}`)
  }
  return rr
}

// ── Trim helpers ──────────────────────────────────────────────

function pickImage(images: R | undefined): R | undefined {
  if (!images) return undefined
  const result: R = {}
  for (const key of ['236x', '474x', '736x', 'orig']) {
    if (images[key]) {
      const img = images[key] as R
      result[key] = { url: img.url, width: img.width, height: img.height }
    }
  }
  return Object.keys(result).length ? result : undefined
}

function trimPinner(p: R | undefined): R | undefined {
  if (!p) return undefined
  return {
    id: p.id,
    username: p.username,
    full_name: p.full_name,
    image_medium_url: p.image_medium_url,
    follower_count: p.follower_count,
  }
}

function trimBoard(b: R | undefined): R | undefined {
  if (!b) return undefined
  return {
    id: b.id,
    name: b.name,
    url: b.url,
    pin_count: b.pin_count,
    is_collaborative: b.is_collaborative,
  }
}

function trimPinResult(raw: R): R {
  return {
    id: raw.id,
    type: raw.type,
    grid_title: raw.grid_title,
    title: raw.title,
    description: raw.description,
    link: raw.link ?? null,
    domain: raw.domain,
    images: pickImage(raw.images as R | undefined),
    dominant_color: raw.dominant_color,
    pinner: trimPinner(raw.pinner as R | undefined),
    board: trimBoard(raw.board as R | undefined),
    created_at: raw.created_at,
    is_video: raw.is_video ?? false,
  }
}

function trimPinDetail(raw: R): R {
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    grid_title: raw.grid_title,
    description: raw.description,
    link: raw.link ?? null,
    domain: raw.domain,
    images: pickImage(raw.images as R | undefined),
    dominant_color: raw.dominant_color,
    pinner: trimPinner(raw.pinner as R | undefined),
    board: trimBoard(raw.board as R | undefined),
    repin_count: raw.repin_count,
    comment_count: raw.comment_count,
    share_count: raw.share_count,
    reaction_counts: raw.reaction_counts,
    created_at: raw.created_at,
    is_video: raw.is_video ?? false,
    category: raw.category,
  }
}

function trimBoardDetail(raw: R): R {
  const owner = raw.owner as R | undefined
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    url: raw.url,
    pin_count: raw.pin_count,
    follower_count: raw.follower_count,
    section_count: raw.section_count,
    collaborator_count: raw.collaborator_count,
    is_collaborative: raw.is_collaborative,
    privacy: raw.privacy,
    image_cover_url: raw.image_cover_url,
    owner: owner ? {
      id: owner.id,
      username: owner.username,
      full_name: owner.full_name,
      image_medium_url: owner.image_medium_url,
    } : undefined,
  }
}

function trimUserProfile(raw: R): R {
  return {
    id: raw.id,
    username: raw.username,
    full_name: raw.full_name,
    about: raw.about,
    follower_count: raw.follower_count,
    following_count: raw.following_count,
    pin_count: raw.pin_count,
    board_count: raw.board_count,
    image_medium_url: raw.image_medium_url,
    website_url: raw.website_url,
    domain_url: raw.domain_url,
    is_verified_merchant: raw.is_verified_merchant,
  }
}

function trimTypeaheadItem(raw: R): R {
  return {
    type: raw.type,
    label: raw.label,
    id: raw.id,
    query: raw.query,
    url: raw.url,
  }
}

function trimHomeFeedItem(raw: R): R | null {
  const nodeId = raw.node_id as string | undefined
  let pinId: string | undefined
  if (nodeId) {
    try {
      const decoded = atob(nodeId)
      const match = decoded.match(/^Pin:(\d+)$/)
      if (match) pinId = match[1]
    } catch { /* not base64 */ }
  }
  const storyData = raw.story_pin_data as R | undefined
  const meta = storyData?.metadata as R | undefined
  const title = meta?.pin_title as string | undefined

  const pages = storyData?.pages as Array<R> | undefined
  let imageUrl: string | undefined
  if (pages?.[0]) {
    const blocks = (pages[0] as R).blocks as Array<R> | undefined
    const imgBlock = blocks?.find(b => b.type === 'story_pin_image_block')
    if (imgBlock) {
      const image = (imgBlock as R).image as R | undefined
      const images = image?.images as R | undefined
      const variant = (images?.['736x'] ?? images?.['474x'] ?? images?.originals) as R | undefined
      imageUrl = variant?.url as string | undefined
    }
  }

  return {
    id: pinId ?? null,
    title: title ?? null,
    image_url: imageUrl ?? null,
    auto_alt_text: raw.auto_alt_text ?? null,
    is_video: raw.is_video ?? false,
  }
}

function trimNotification(raw: R): R {
  const contentItems = (raw.content_items as Array<R>) ?? []
  return {
    id: raw.id,
    type: raw.type,
    category: raw.category,
    header_text: raw.header_text,
    unread: raw.unread,
    last_updated_at: raw.last_updated_at,
    content_items: contentItems.slice(0, 5).map(ci => {
      const contentObj = ci.content_object as R | undefined
      return {
        event_type: ci.event_type,
        last_updated_at: ci.last_updated_at,
        content_object: contentObj ? {
          id: contentObj.id ?? contentObj.content_object_id,
          title: contentObj.title,
          image_large_url: contentObj.image_large_url,
          is_video: contentObj.is_video,
        } : undefined,
      }
    }),
  }
}

// ── Operation handlers ────────────────────────────────────────

type Handler = (page: Page, params: Readonly<R>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  async searchPins(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/search/pins/?q=cats')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/BaseSearchResource/get/', sourceUrl, data, 'www/search/[scope].js')
    const d = rr.data as R
    const results = (d.results as Array<R>) ?? []
    return {
      results: results.map(trimPinResult),
      bookmark: rr.bookmark ?? null,
    }
  },

  async getPin(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/PinResource/get/', sourceUrl, data)
    return trimPinDetail(rr.data as R)
  },

  async getBoard(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/BoardResource/get/', sourceUrl, data)
    return trimBoardDetail(rr.data as R)
  },

  async getUserProfile(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/UserResource/get/', sourceUrl, data)
    return trimUserProfile(rr.data as R)
  },

  async searchTypeahead(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/AdvancedTypeaheadResource/get/', sourceUrl, data, 'www/index.js')
    const d = rr.data as R
    const items = (d.items as Array<R>) ?? []
    return { items: items.map(trimTypeaheadItem) }
  },

  async getHomeFeed(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/UserHomefeedResource/get/', sourceUrl, data, 'www/index.js')
    const items = (rr.data as Array<R>) ?? []
    return {
      pins: items.map(trimHomeFeedItem).filter(Boolean),
      bookmark: rr.bookmark ?? null,
    }
  },

  async getNotifications(page, params, helpers) {
    const sourceUrl = String(params.source_url || '/notifications/')
    const data = String(params.data || '')
    if (!data) throw helpers.errors.missingParam('data')
    const rr = await pinterestGet(helpers, page, '/resource/NewsHubResource/get/', sourceUrl, data, 'www/notifications.js')
    const items = (rr.data as Array<R>) ?? []
    return {
      notifications: items.map(trimNotification),
      bookmark: rr.bookmark ?? null,
    }
  },
}

const adapter: CustomRunner = {
  name: 'pinterest-api',
  description: 'Pinterest — read operations with response trimming',

  async run(ctx: PreparedContext) {
    const { operation, params, helpers, page } = ctx
    if (!page) throw helpers.errors.fatal('Pinterest requires a browser page')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default adapter
