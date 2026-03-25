/**
 * YouTube Music L3 adapter — InnerTube API via browser fetch.
 *
 * YouTube Music uses the same InnerTube API as regular YouTube but with
 * client name WEB_REMIX. All public data (search, browse, player) works
 * without auth. API key extracted from ytcfg page global.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import {
  type Obj,
  runs,
  thumbUrl,
  browseContents,
  twoColBrowse,
  parseShelfItems,
  parseCarouselItems,
} from './transforms.js'

const API_BASE = '/youtubei/v1'

/* ---------- InnerTube fetch ---------- */

interface InnerTubeConfig {
  apiKey: string
  clientVersion: string
}

async function getConfig(page: Page): Promise<InnerTubeConfig> {
  return page.evaluate(() => {
    const ytcfg = (window as Record<string, unknown>).ytcfg as Record<string, unknown> | undefined
    const get = ytcfg?.get as ((key: string) => string) | undefined
    return {
      apiKey: get?.('INNERTUBE_API_KEY') ?? 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
      clientVersion: get?.('INNERTUBE_CLIENT_VERSION') ?? '1.20260318.00.00',
    }
  })
}

async function innerTube(
  page: Page,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = await getConfig(page)
  const payload = {
    context: { client: { clientName: 'WEB_REMIX', clientVersion: config.clientVersion, hl: 'en', gl: 'US' } },
    ...body,
  }

  const result = await page.evaluate(
    async (args: { base: string; endpoint: string; key: string; payload: string }) => {
      const resp = await fetch(`${args.base}/${args.endpoint}?key=${args.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: args.payload,
      })
      return { status: resp.status, text: await resp.text() }
    },
    { base: API_BASE, endpoint, key: config.apiKey, payload: JSON.stringify(payload) },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as Record<string, unknown>
  if (json.error) {
    const err = json.error as Record<string, unknown>
    throw OpenWebError.apiError('YouTube Music ' + endpoint, String(err.message ?? 'Unknown error'))
  }
  return json
}

/* ---------- operation handlers ---------- */

async function searchMusic(page: Page, params: Obj): Promise<unknown> {
  const query = String(params.query ?? '')
  const data = await innerTube(page, 'search', { query })

  const tabbed = (data.contents as Obj)?.tabbedSearchResultsRenderer as Obj
  const tab = ((tabbed?.tabs as Array<Obj>)?.[0]?.tabRenderer as Obj)?.content as Obj
  const sections = ((tab?.sectionListRenderer as Obj)?.contents as Array<Obj>) ?? []

  return {
    sections: sections.map((s) => {
      const shelf = s.musicShelfRenderer as Obj
      if (shelf) {
        return {
          title: runs(shelf.title) || 'Top result',
          items: parseShelfItems(shelf),
        }
      }
      const card = s.musicCardShelfRenderer as Obj
      if (card) {
        return {
          title: runs(card.title),
          type: 'card',
          subtitle: runs(card.subtitle),
        }
      }
      return null
    }).filter(Boolean),
  }
}

async function getAlbum(page: Page, params: Obj): Promise<unknown> {
  const browseId = String(params.browseId ?? params.albumId ?? '')
  const data = await innerTube(page, 'browse', { browseId })
  const { primary, secondary } = twoColBrowse(data)

  const header = primary[0]?.musicResponsiveHeaderRenderer as Obj | undefined
  const trackShelf = secondary[0]?.musicShelfRenderer as Obj | undefined
  const micro = (data.microformat as Obj)?.microformatDataRenderer as Obj | undefined
  const bgThumbs = ((data.background as Obj)?.musicThumbnailRenderer as Obj)?.thumbnail as Obj

  return {
    title: header ? runs(header.title) : micro?.title ?? null,
    subtitle: header ? runs(header.subtitle) : null,
    artist: header ? runs(header.straplineTextOne) : null,
    description: header
      ? runs((header.description as Obj)?.musicDescriptionShelfRenderer?.description)
      : micro?.description ?? null,
    thumbnail: ((bgThumbs?.thumbnails as Array<Obj>) ?? [])[0]?.url ?? null,
    trackCount: (trackShelf?.contents as Array<Obj>)?.length ?? 0,
    tracks: parseShelfItems(trackShelf ?? {}),
  }
}

async function getPlaylist(page: Page, params: Obj): Promise<unknown> {
  let browseId = String(params.browseId ?? params.playlistId ?? '')
  if (!browseId.startsWith('VL')) browseId = `VL${browseId}`
  const data = await innerTube(page, 'browse', { browseId })
  const { primary, secondary } = twoColBrowse(data)

  const header = primary[0]?.musicResponsiveHeaderRenderer as Obj | undefined
  const trackShelf = (secondary[0]?.musicShelfRenderer ?? secondary[0]?.musicPlaylistShelfRenderer) as Obj | undefined
  const micro = (data.microformat as Obj)?.microformatDataRenderer as Obj | undefined

  return {
    title: header ? runs(header.title) : micro?.title ?? null,
    subtitle: header ? runs(header.subtitle) : null,
    author: header ? runs(header.straplineTextOne) : null,
    thumbnail: micro?.thumbnail ? ((micro.thumbnail as Obj)?.thumbnails as Array<Obj>)?.[0]?.url ?? null : null,
    trackCount: (trackShelf?.contents as Array<Obj>)?.length ?? 0,
    tracks: parseShelfItems(trackShelf ?? {}),
  }
}

async function getArtist(page: Page, params: Obj): Promise<unknown> {
  const browseId = String(params.browseId ?? params.channelId ?? '')
  const data = await innerTube(page, 'browse', { browseId })

  const header = (data.header as Obj)?.musicImmersiveHeaderRenderer as Obj
    ?? (data.header as Obj)?.musicVisualHeaderRenderer as Obj
  const sections = browseContents(data)

  const subBtn = (header?.subscriptionButton as Obj)?.subscribeButtonRenderer as Obj

  return {
    name: runs(header?.title),
    subscribers: runs(subBtn?.subscriberCountText),
    thumbnail: thumbUrl(header ?? {}),
    sections: sections.slice(0, 6).map((s) => {
      const shelf = s.musicShelfRenderer as Obj
      if (shelf) {
        return { title: runs(shelf.title), items: parseShelfItems(shelf).slice(0, 5) }
      }
      const carousel = s.musicCarouselShelfRenderer as Obj
      if (carousel) {
        const cHeader = carousel.header as Obj
        const basicHeader = cHeader?.musicCarouselShelfBasicHeaderRenderer as Obj
        return { title: runs(basicHeader?.title), items: parseCarouselItems(carousel).slice(0, 5) }
      }
      return null
    }).filter(Boolean),
  }
}

async function getSong(page: Page, params: Obj): Promise<unknown> {
  const videoId = String(params.videoId ?? '')
  const data = await innerTube(page, 'player', { videoId })

  const details = data.videoDetails as Obj | undefined
  const micro = (data.microformat as Obj)?.microformatDataRenderer as Obj
    ?? (data.microformat as Obj)?.playerMicroformatRenderer as Obj
  const thumbs = ((details?.thumbnail as Obj)?.thumbnails as Array<Obj>) ?? []

  return {
    videoId: details?.videoId,
    title: details?.title,
    author: details?.author,
    channelId: details?.channelId,
    lengthSeconds: details?.lengthSeconds ? Number(details.lengthSeconds) : null,
    viewCount: details?.viewCount ? Number(details.viewCount) : null,
    thumbnail: thumbs[thumbs.length - 1]?.url ?? null,
    isLive: details?.isLiveContent ?? false,
    description: micro?.description ? String(micro.description).slice(0, 500) : null,
  }
}

async function getUpNext(page: Page, params: Obj): Promise<unknown> {
  const videoId = String(params.videoId ?? '')
  const playlistId = params.playlistId ? String(params.playlistId) : undefined
  const data = await innerTube(page, 'next', { videoId, isAudioOnly: true, ...(playlistId ? { playlistId } : {}) })

  const watch = (data.contents as Obj)?.singleColumnMusicWatchNextResultsRenderer as Obj
  const tabbed = (watch?.tabbedRenderer as Obj)?.watchNextTabbedResultsRenderer as Obj
  const tabs = (tabbed?.tabs as Array<Obj>) ?? []

  const upNextTab = tabs[0]?.tabRenderer as Obj
  const queue = (upNextTab?.content as Obj)?.musicQueueRenderer as Obj
  const panel = (queue?.content as Obj)?.playlistPanelRenderer as Obj
  const items = (panel?.contents as Array<Obj>) ?? []

  const tracks = items.slice(0, 25).map((c) => {
    const v = c.playlistPanelVideoRenderer as Obj
    if (!v) return null
    const ep = (v.navigationEndpoint as Obj)?.watchEndpoint as Obj
    return {
      title: runs(v.title),
      artist: runs(v.shortBylineText),
      duration: runs(v.lengthText),
      videoId: ep?.videoId ?? null,
    }
  }).filter(Boolean)

  return {
    currentVideoId: videoId,
    trackCount: items.length,
    tracks,
    lyricsBrowseId: ((tabs[1]?.tabRenderer as Obj)?.endpoint as Obj)?.browseEndpoint
      ? String(((tabs[1]?.tabRenderer as Obj)?.endpoint as Obj)?.browseEndpoint
        ? (((tabs[1]?.tabRenderer as Obj)?.endpoint as Obj)?.browseEndpoint as Obj)?.browseId : null)
      : null,
    relatedBrowseId: ((tabs[2]?.tabRenderer as Obj)?.endpoint as Obj)?.browseEndpoint
      ? String((((tabs[2]?.tabRenderer as Obj)?.endpoint as Obj)?.browseEndpoint as Obj)?.browseId ?? '')
      : null,
  }
}

async function getLyrics(page: Page, params: Obj): Promise<unknown> {
  let browseId = params.browseId ? String(params.browseId) : null

  // If no browseId, get it from the next endpoint
  if (!browseId && params.videoId) {
    const next = await innerTube(page, 'next', { videoId: String(params.videoId), isAudioOnly: true })
    const watch = (next.contents as Obj)?.singleColumnMusicWatchNextResultsRenderer as Obj
    const tabs = (((watch?.tabbedRenderer as Obj)?.watchNextTabbedResultsRenderer as Obj)?.tabs as Array<Obj>) ?? []
    const lyricsTab = tabs[1]?.tabRenderer as Obj
    browseId = (((lyricsTab?.endpoint as Obj)?.browseEndpoint as Obj)?.browseId as string) ?? null
  }

  if (!browseId) return { available: false, text: null, source: null }

  const data = await innerTube(page, 'browse', { browseId })
  const sections = ((data.contents as Obj)?.sectionListRenderer as Obj)?.contents as Array<Obj> | undefined
  const shelf = sections?.[0]?.musicDescriptionShelfRenderer as Obj | undefined

  return {
    available: !!shelf,
    text: shelf ? runs(shelf.description) : null,
    source: shelf ? runs(shelf.footer) : null,
  }
}

async function browseHome(page: Page, _params: Obj): Promise<unknown> {
  const data = await innerTube(page, 'browse', { browseId: 'FEmusic_home' })
  const sections = browseContents(data)

  return {
    sections: sections.slice(0, 8).map((s) => {
      const carousel = s.musicCarouselShelfRenderer as Obj
      if (carousel) {
        const cHeader = (carousel.header as Obj)?.musicCarouselShelfBasicHeaderRenderer as Obj
        return {
          title: runs(cHeader?.title),
          items: parseCarouselItems(carousel).slice(0, 6),
        }
      }
      return null
    }).filter(Boolean),
  }
}

async function getSearchSuggestions(page: Page, params: Obj): Promise<unknown> {
  const input = String(params.input ?? params.query ?? '')
  const data = await innerTube(page, 'music/get_search_suggestions', { input })

  const sections = (data.contents as Array<Obj>) ?? []
  const suggestions: Array<Obj> = []

  for (const section of sections) {
    const renderer = section.searchSuggestionsSectionRenderer as Obj
    const items = (renderer?.contents as Array<Obj>) ?? []
    for (const item of items) {
      const sug = item.searchSuggestionRenderer as Obj
      if (sug) {
        suggestions.push({ text: runs(sug.suggestion), type: 'query' })
        continue
      }
      const hist = item.historySuggestionRenderer as Obj
      if (hist) {
        suggestions.push({ text: runs(hist.suggestion), type: 'history' })
      }
    }
  }

  return { suggestions }
}

async function browseCharts(page: Page, _params: Obj): Promise<unknown> {
  const data = await innerTube(page, 'browse', { browseId: 'FEmusic_charts' })
  const sections = browseContents(data)

  return {
    sections: sections.map((s) => {
      const shelf = s.musicShelfRenderer as Obj
      if (shelf) {
        return {
          title: runs(shelf.title) || 'Top songs',
          type: 'shelf',
          items: parseShelfItems(shelf).slice(0, 20),
        }
      }
      const carousel = s.musicCarouselShelfRenderer as Obj
      if (carousel) {
        const cHeader = (carousel.header as Obj)?.musicCarouselShelfBasicHeaderRenderer as Obj
        return {
          title: runs(cHeader?.title),
          type: 'carousel',
          items: parseCarouselItems(carousel).slice(0, 10),
        }
      }
      return null
    }).filter(Boolean),
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Obj) => Promise<unknown>> = {
  searchMusic,
  getAlbum,
  getPlaylist,
  getArtist,
  getSong,
  getUpNext,
  getLyrics,
  browseHome,
  getSearchSuggestions,
  browseCharts,
}

const adapter: CodeAdapter = {
  name: 'youtube-music-innertube',
  description: 'YouTube Music InnerTube API — search, albums, playlists, artists, songs, lyrics, charts',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('music.youtube.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All operations use public data
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
