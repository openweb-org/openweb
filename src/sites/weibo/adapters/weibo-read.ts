import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Obj = Record<string, unknown>
type Errors = AdapterHelpers['errors']

function str(v: unknown): string { return v == null ? '' : String(v) }
function int(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

async function fetchJson(
  helpers: AdapterHelpers, page: Page, url: string,
): Promise<unknown> {
  const { pageFetch, errors } = helpers
  const result = await pageFetch(page, {
    url, method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (result.status === 401 || result.status === 403) throw errors.needsLogin()
  if (result.status >= 400) throw errors.httpError(result.status)
  try { return JSON.parse(result.text) } catch { throw errors.fatal('Response is not valid JSON') }
}

function qs(base: string, params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `${base}?${parts.join('&')}` : base
}

// ── Trim helpers ──

function clean(obj: Obj): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

function trimUser(u: Obj | undefined | null): Obj | undefined {
  if (!u) return undefined
  return clean({
    id: u.id, idstr: u.idstr, screen_name: u.screen_name,
    profile_image_url: u.profile_image_url, profile_url: u.profile_url,
    verified: u.verified, verified_type: u.verified_type,
    verified_reason: u.verified_reason, description: u.description,
    location: u.location, gender: u.gender,
    followers_count: u.followers_count, followers_count_str: u.followers_count_str,
    friends_count: u.friends_count, statuses_count: u.statuses_count,
    avatar_large: u.avatar_large, avatar_hd: u.avatar_hd, mbrank: u.mbrank,
  })
}

function trimUserCompact(u: Obj | undefined | null): Obj | undefined {
  if (!u) return undefined
  return {
    id: u.id, idstr: u.idstr, screen_name: u.screen_name,
    profile_image_url: u.profile_image_url,
    verified: u.verified, avatar_hd: u.avatar_hd,
  }
}

function trimPicInfos(pics: Obj | undefined | null): Obj | undefined {
  if (!pics || typeof pics !== 'object') return undefined
  const out: Obj = {}
  for (const [k, v] of Object.entries(pics)) {
    const p = v as Obj
    out[k] = {
      pic_id: p.pic_id, photo_tag: p.photo_tag, type: p.type,
      thumbnail: p.thumbnail, bmiddle: p.bmiddle,
      large: p.large, original: p.original,
    }
  }
  return out
}

function trimRetweeted(rt: Obj | undefined | null): Obj | undefined {
  if (!rt) return undefined
  return clean({
    id: rt.id, idstr: rt.idstr, mid: rt.mid, mblogid: rt.mblogid,
    created_at: rt.created_at, text: rt.text, text_raw: rt.text_raw,
    source: rt.source, user: trimUserCompact(rt.user as Obj),
    reposts_count: rt.reposts_count, comments_count: rt.comments_count,
    attitudes_count: rt.attitudes_count,
    pic_ids: rt.pic_ids, pic_num: rt.pic_num,
  })
}

function trimPost(p: Obj): Obj {
  return clean({
    id: p.id, idstr: p.idstr, mid: p.mid, mblogid: p.mblogid,
    created_at: p.created_at, text: p.text, text_raw: p.text_raw,
    source: p.source, user: trimUser(p.user as Obj),
    reposts_count: p.reposts_count, comments_count: p.comments_count,
    attitudes_count: p.attitudes_count, isLongText: p.isLongText,
    pic_ids: p.pic_ids, pic_num: p.pic_num,
    pic_infos: trimPicInfos(p.pic_infos as Obj),
    retweeted_status: trimRetweeted(p.retweeted_status as Obj),
  })
}

// ── Operation handlers ──

const API = 'https://weibo.com'

async function getHotSearch(helpers: AdapterHelpers, page: Page) {
  const raw = await fetchJson(helpers, page, `${API}/ajax/side/hotSearch`) as Obj
  const data = raw.data as Obj
  const hotgov = data.hotgov as Obj | undefined
  const realtime = ((data.realtime ?? []) as Obj[]).map(item => ({
    word: item.word, note: item.note, num: item.num,
    rank: item.rank, icon_desc: item.icon_desc, word_scheme: item.word_scheme,
  }))
  return {
    ok: raw.ok,
    data: {
      hotgov: hotgov ? { name: hotgov.name, word: hotgov.word, mid: hotgov.mid, url: hotgov.url } : undefined,
      realtime,
    },
  }
}

async function getHotFeed(helpers: AdapterHelpers, page: Page, params: Params) {
  const url = qs(`${API}/ajax/feed/hottimeline`, {
    group_id: int(params.group_id as number, 102803),
    containerid: int(params.containerid as number, 102803),
    extparam: str(params.extparam) || 'discover|new_feed',
    since_id: params.since_id != null ? int(params.since_id as number, 0) : undefined,
    max_id: params.max_id != null ? int(params.max_id as number, 0) : undefined,
    count: params.count != null ? int(params.count as number, 10) : undefined,
    refresh: params.refresh != null ? int(params.refresh as number, 0) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  return {
    statuses: ((raw.statuses ?? []) as Obj[]).map(trimPost),
    since_id: raw.since_id, max_id: raw.max_id, total_number: raw.total_number,
  }
}

async function getFriendsFeed(helpers: AdapterHelpers, page: Page, params: Params) {
  const url = qs(`${API}/ajax/feed/friendstimeline`, {
    list_id: str(params.list_id) || 'my_follow_all',
    refresh: params.refresh != null ? int(params.refresh as number, 4) : undefined,
    since_id: params.since_id != null ? int(params.since_id as number, 0) : undefined,
    count: params.count != null ? int(params.count as number, 25) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  return {
    statuses: ((raw.statuses ?? []) as Obj[]).map(trimPost),
    since_id: raw.since_id, max_id: raw.max_id,
  }
}

async function getUserProfile(helpers: AdapterHelpers, page: Page, params: Params) {
  const uid = params.uid
  if (uid == null) throw helpers.errors.missingParam('uid')
  const url = qs(`${API}/ajax/profile/info`, {
    uid: int(uid as number, 0),
    scene: params.scene != null ? str(params.scene) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  const data = raw.data as Obj
  const user = trimUser(data.user as Obj)
  const tabList = ((data.tabList ?? []) as Obj[]).map(t => ({
    tabKey: t.name ?? t.tabKey,
    title: t.tabName ?? t.title,
  }))
  return { ok: raw.ok, data: { user, tabList } }
}

async function getUserDetail(helpers: AdapterHelpers, page: Page, params: Params) {
  const uid = params.uid
  if (uid == null) throw helpers.errors.missingParam('uid')
  const url = qs(`${API}/ajax/profile/detail`, { uid: int(uid as number, 0) })
  const raw = await fetchJson(helpers, page, url) as Obj
  const d = raw.data as Obj
  const sc = d.sunshine_credit as Obj | undefined
  return {
    ok: raw.ok,
    data: clean({
      ip_location: d.ip_location, created_at: d.created_at,
      birthday: d.birthday,
      sunshine_credit: sc ? { level: sc.level } : undefined,
      education: d.education ? { school: (d.education as Obj).school } : undefined,
      company: d.company,
    }),
  }
}

async function getUserStatuses(helpers: AdapterHelpers, page: Page, params: Params) {
  const uid = params.uid
  if (uid == null) throw helpers.errors.missingParam('uid')
  const url = qs(`${API}/ajax/statuses/mymblog`, {
    uid: int(uid as number, 0),
    page: params.page != null ? int(params.page as number, 1) : undefined,
    feature: params.feature != null ? int(params.feature as number, 0) : undefined,
    since_id: params.since_id != null ? str(params.since_id) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  const data = raw.data as Obj
  return {
    ok: raw.ok,
    data: {
      list: ((data.list ?? []) as Obj[]).map(trimPost),
      since_id: data.since_id, total: data.total,
    },
  }
}

async function getPost(helpers: AdapterHelpers, page: Page, params: Params) {
  const id = str(params.id)
  if (!id) throw helpers.errors.missingParam('id')
  const url = qs(`${API}/ajax/statuses/show`, {
    id,
    isGetLongText: params.isGetLongText !== false ? 'true' : 'false',
    locale: params.locale != null ? str(params.locale) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  return trimPost(raw)
}

async function getLongtext(helpers: AdapterHelpers, page: Page, params: Params) {
  const id = str(params.id)
  if (!id) throw helpers.errors.missingParam('id')
  const url = qs(`${API}/ajax/statuses/longtext`, { id })
  const raw = await fetchJson(helpers, page, url) as Obj
  const d = raw.data as Obj
  const urlStruct = d.url_struct
    ? (d.url_struct as Obj[]).map(u => ({
        url_title: u.url_title, ori_url: u.ori_url,
        short_url: u.short_url, url_type: u.url_type,
      }))
    : undefined
  return {
    ok: raw.ok,
    data: {
      longTextContent: d.longTextContent,
      longTextContent_raw: d.longTextContent_raw,
      url_struct: urlStruct,
      isMarkdown: d.isMarkdown,
    },
  }
}

async function listReposts(helpers: AdapterHelpers, page: Page, params: Params) {
  const id = params.id
  if (id == null) throw helpers.errors.missingParam('id')
  const url = qs(`${API}/ajax/statuses/repostTimeline`, {
    id: int(id as number, 0),
    page: params.page != null ? int(params.page as number, 1) : undefined,
    count: params.count != null ? int(params.count as number, 10) : undefined,
  })
  const raw = await fetchJson(helpers, page, url) as Obj
  return clean({
    ok: raw.ok,
    data: ((raw.data ?? []) as Obj[]).map(trimPost),
    total_number: raw.total_number,
    max_page: raw.max_page,
    next_cursor: raw.next_cursor,
  })
}

const adapter: CustomRunner = {
  name: 'weibo-read',
  description: 'Weibo — read operations with response trimming',

  async run(ctx) {
    const { operation, params, helpers, page } = ctx
    if (!page) throw helpers.errors.fatal('Weibo adapter requires a browser page')

    switch (operation) {
      case 'getHotSearch': return getHotSearch(helpers, page)
      case 'getHotFeed': return getHotFeed(helpers, page, params)
      case 'getFriendsFeed': return getFriendsFeed(helpers, page, params)
      case 'getUserProfile': return getUserProfile(helpers, page, params)
      case 'getUserDetail': return getUserDetail(helpers, page, params)
      case 'getUserStatuses': return getUserStatuses(helpers, page, params)
      case 'getPost': return getPost(helpers, page, params)
      case 'getLongtext': return getLongtext(helpers, page, params)
      case 'listReposts': return listReposts(helpers, page, params)
      default: throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
