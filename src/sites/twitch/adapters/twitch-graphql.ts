import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Twitch L3 adapter — GraphQL API via browser fetch (persisted queries).
 *
 * Twitch serves all data through gql.twitch.tv using persisted queries.
 * No auth required for public data (streams, channels, categories, clips).
 * Client-ID header is required (public anonymous key).
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import { getTopStreams, gqlFetch, gqlMutate } from './queries.js'

/* ---------- operation handlers ---------- */

async function searchChannels(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.term ?? '')
  const data = (await gqlFetch(page, 'SearchResultsPage_SearchResults', {
    platform: 'web',
    query,
    options: { targets: null, shouldSkipDiscoveryControl: false },
    requestID: '',
  })) as Record<string, unknown>

  const searchFor = data.searchFor as Record<string, unknown>
  const channels = searchFor?.channels as Record<string, unknown>
  const edges = (channels?.edges ?? []) as Array<Record<string, unknown>>

  return {
    cursor: channels?.cursor,
    channels: edges.map((e) => {
      const item = e.item as Record<string, unknown>
      const followers = item?.followers as Record<string, unknown>
      const broadcast = item?.broadcastSettings as Record<string, unknown>
      return {
        id: item?.id,
        login: item?.login,
        displayName: item?.displayName,
        description: item?.description,
        profileImageURL: item?.profileImageURL,
        followers: followers?.totalCount,
        broadcastTitle: broadcast?.title,
      }
    }),
  }
}

async function getChannelInfo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const data = (await gqlFetch(page, 'ChannelRoot_AboutPanel', {
    channelLogin,
    skipSchedule: false,
  })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  const followers = user?.followers as Record<string, unknown>
  const roles = user?.roles as Record<string, unknown>
  const channel = user?.channel as Record<string, unknown>
  const socials = (channel?.socialMedias ?? []) as Array<Record<string, unknown>>
  const schedule = channel?.schedule as Record<string, unknown>
  const nextSeg = schedule?.nextSegment as Record<string, unknown> | null

  return {
    id: user?.id,
    displayName: user?.displayName,
    description: user?.description,
    profileImageURL: user?.profileImageURL,
    primaryColorHex: user?.primaryColorHex,
    followers: followers?.totalCount,
    isPartner: roles?.isPartner,
    isAffiliate: roles?.isAffiliate,
    socialMedias: socials.map((s) => ({ name: s.name, title: s.title, url: s.url })),
    nextScheduleSegment: nextSeg
      ? { startAt: nextSeg.startAt, title: nextSeg.title, hasReminder: nextSeg.hasReminder }
      : null,
  }
}

async function getStreamInfo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const data = (await gqlFetch(page, 'StreamMetadata', { channelLogin })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  const stream = user?.stream as Record<string, unknown> | null
  const game = stream?.game as Record<string, unknown> | null
  const lastBroadcast = user?.lastBroadcast as Record<string, unknown> | null

  return {
    id: user?.id,
    profileImageURL: user?.profileImageURL,
    primaryColorHex: user?.primaryColorHex,
    isPartner: (user?.roles as Record<string, unknown>)?.isPartner,
    lastBroadcastTitle: lastBroadcast?.title,
    stream: stream
      ? {
          id: stream.id,
          type: stream.type,
          createdAt: stream.createdAt,
          game: game ? { id: game.id, slug: game.slug, name: game.name } : null,
        }
      : null,
  }
}

async function getChannelSchedule(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const login = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 59)

  const data = (await gqlFetch(page, 'StreamSchedule', {
    login,
    startingWeekday: 'MONDAY',
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    startAt: weekStart.toISOString(),
    endAt: weekEnd.toISOString(),
  })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  const stream = user?.stream as Record<string, unknown> | null
  const videos = user?.videos as Record<string, unknown>
  const videoEdges = ((videos?.edges ?? []) as Array<Record<string, unknown>>).slice(0, 5)
  const channel = user?.channel as Record<string, unknown>
  const schedule = channel?.schedule as Record<string, unknown>
  const segments = ((schedule?.segments ?? []) as Array<Record<string, unknown>>).slice(0, 10)

  return {
    isLive: stream !== null,
    currentStream: stream
      ? {
          id: stream.id,
          viewersCount: stream.viewersCount,
          createdAt: stream.createdAt,
          game: (stream.game as Record<string, unknown>)?.name,
        }
      : null,
    recentVideos: videoEdges.map((e) => {
      const node = e.node as Record<string, unknown>
      return { id: node?.id, title: node?.title, createdAt: node?.createdAt, lengthSeconds: node?.lengthSeconds }
    }),
    scheduleSegments: segments.map((s) => ({
      id: s.id,
      startAt: s.startAt,
      endAt: s.endAt,
      title: s.title,
      categories: ((s.categories ?? []) as Array<Record<string, unknown>>).map((c) => c.name),
    })),
  }
}

async function getChannelVideos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const first = Number(params.limit ?? 5)

  const data = (await gqlFetch(page, 'ChannelVideoShelvesQuery', {
    includePreviewBlur: false,
    channelLogin,
    first,
  })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  const shelves = user?.videoShelves as Record<string, unknown>
  const edges = (shelves?.edges ?? []) as Array<Record<string, unknown>>

  return {
    shelves: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const items = (node?.items ?? []) as Array<Record<string, unknown>>
      return {
        title: node?.title,
        type: node?.type,
        items: items.map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.clipTitle ?? item.title,
          viewCount: item.clipViewCount ?? item.viewCount,
          createdAt: item.createdAt,
          durationSeconds: item.durationSeconds,
          game: (item.clipGame ?? item.game) as Record<string, unknown>,
        })),
      }
    }),
  }
}

async function getChannelClips(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const login = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const limit = Number(params.limit ?? 20)
  const filter = String(params.filter ?? 'LAST_WEEK')
  const cursor = params.cursor ? String(params.cursor) : null

  const data = (await gqlFetch(page, 'ClipsCards__User', {
    login,
    limit,
    criteria: { filter, shouldFilterByDiscoverySetting: true },
    cursor,
  })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  const clips = user?.clips as Record<string, unknown>
  const pageInfo = clips?.pageInfo as Record<string, unknown>
  const edges = (clips?.edges ?? []) as Array<Record<string, unknown>>

  return {
    hasNextPage: pageInfo?.hasNextPage,
    clips: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const game = node?.game as Record<string, unknown>
      const curator = node?.curator as Record<string, unknown>
      return {
        id: node?.id,
        slug: node?.slug,
        title: node?.title,
        url: node?.url,
        viewCount: node?.viewCount,
        language: node?.language,
        createdAt: node?.createdAt,
        durationSeconds: node?.durationSeconds,
        thumbnailURL: node?.thumbnailURL,
        curator: curator ? { login: curator.login, displayName: curator.displayName } : null,
        game: game ? { id: game.id, name: game.name, slug: game.slug } : null,
      }
    }),
  }
}

async function browseCategories(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const limit = Number(params.limit ?? 30)

  const data = (await gqlFetch(page, 'BrowsePage_AllDirectories', {
    limit,
    options: {
      recommendationsContext: { platform: 'web' },
      requestID: 'JIRA-VXP-2397',
      sort: 'RELEVANCE',
      tags: [],
    },
  })) as Record<string, unknown>

  const dirs = data.directoriesWithTags as Record<string, unknown>
  const edges = (dirs?.edges ?? []) as Array<Record<string, unknown>>

  return {
    categories: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const tags = (node?.tags ?? []) as Array<Record<string, unknown>>
      return {
        id: node?.id,
        slug: node?.slug,
        displayName: node?.displayName,
        avatarURL: node?.avatarURL,
        viewersCount: node?.viewersCount,
        tags: tags.map((t) => t.localizedName ?? t.tagName),
      }
    }),
  }
}

async function getCategoryStreams(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const slug = String(params.slug ?? params.category ?? params.game ?? '')
  const limit = Number(params.limit ?? 30)

  const data = (await gqlFetch(page, 'DirectoryPage_Game', {
    imageWidth: 50,
    slug,
    options: {
      sort: 'RELEVANCE',
      recommendationsContext: { platform: 'web' },
      requestID: 'JIRA-VXP-2397',
      freeformTags: null,
      tags: [],
      broadcasterLanguages: [],
      systemFilters: [],
    },
    sortTypeIsRecency: false,
    limit,
    includeCostreaming: true,
  })) as Record<string, unknown>

  const game = data.game as Record<string, unknown>
  const streams = game?.streams as Record<string, unknown>
  const edges = (streams?.edges ?? []) as Array<Record<string, unknown>>

  return {
    category: { id: game?.id, name: game?.displayName },
    streams: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const broadcaster = node?.broadcaster as Record<string, unknown>
      const streamGame = node?.game as Record<string, unknown>
      const tags = (node?.freeformTags ?? []) as Array<Record<string, unknown>>
      return {
        id: node?.id,
        title: node?.title,
        viewersCount: node?.viewersCount,
        previewImageURL: node?.previewImageURL,
        broadcaster: broadcaster
          ? { login: broadcaster.login, displayName: broadcaster.displayName, profileImageURL: broadcaster.profileImageURL }
          : null,
        game: streamGame ? { id: streamGame.id, name: streamGame.name } : null,
        tags: tags.map((t) => t.name),
      }
    }),
  }
}

async function getFeaturedStreams(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const first = Number(params.limit ?? 8)
  const language = String(params.language ?? 'en')

  const data = (await gqlFetch(page, 'FeaturedContentCarouselStreams', {
    language,
    first,
    acceptedMature: true,
  })) as Record<string, unknown>

  const streams = (data.featuredStreams ?? []) as Array<Record<string, unknown>>

  return {
    streams: streams.map((fs) => {
      const stream = fs.stream as Record<string, unknown>
      const broadcaster = stream?.broadcaster as Record<string, unknown>
      const game = stream?.game as Record<string, unknown>
      const tags = (stream?.freeformTags ?? []) as Array<Record<string, unknown>>
      return {
        isSponsored: fs.isSponsored,
        sourceType: fs.sourceType,
        stream: stream
          ? {
              id: stream.id,
              type: stream.type,
              viewersCount: stream.viewersCount,
              previewImageURL: stream.previewImageURL,
              broadcaster: broadcaster
                ? { login: broadcaster.login, displayName: broadcaster.displayName }
                : null,
              game: game ? { id: game.id, name: game.name, displayName: game.displayName } : null,
              tags: tags.map((t) => t.name),
            }
          : null,
      }
    }),
  }
}

/* ---------- write operations ---------- */

const FOLLOW_MUTATION = `
mutation FollowChannelByLogin($channelID: ID!, $disableNotifications: Boolean!) {
  followUser(input: {
    targetID: $channelID,
    disableNotifications: $disableNotifications
  }) {
    follow {
      disableNotifications
      user {
        id
        login
        displayName
      }
    }
    error {
      code
    }
  }
}
`

async function followChannel(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? params.login ?? params.channel ?? '')
  const disableNotifications = Boolean(params.disableNotifications ?? false)

  // Resolve channelLogin → channelID via getChannelInfo
  const channelData = (await gqlFetch(page, 'ChannelRoot_AboutPanel', {
    channelLogin,
    skipSchedule: true,
  })) as Record<string, unknown>

  const user = channelData.user as Record<string, unknown>
  if (!user?.id) {
    throw OpenWebError.apiError('followChannel', `Channel "${channelLogin}" not found`)
  }
  const channelID = String(user.id)

  const data = (await gqlMutate(page, FOLLOW_MUTATION, {
    channelID,
    disableNotifications,
  })) as Record<string, unknown>

  const result = data.followUser as Record<string, unknown>
  const error = result?.error as Record<string, unknown> | null
  if (error?.code) {
    throw OpenWebError.apiError('followChannel', `Follow failed: ${error.code}`)
  }

  const follow = result?.follow as Record<string, unknown>
  const followedUser = follow?.user as Record<string, unknown>

  return {
    channelId: followedUser?.id ?? channelID,
    channelLogin: followedUser?.login ?? channelLogin,
    displayName: followedUser?.displayName,
    isFollowing: true,
    disableNotifications: follow?.disableNotifications ?? disableNotifications,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchChannels,
  getChannelInfo,
  getStreamInfo,
  getChannelSchedule,
  getChannelVideos,
  getChannelClips,
  browseCategories,
  getCategoryStreams,
  getTopStreams,
  getFeaturedStreams,
  followChannel,
}

const adapter: CodeAdapter = {
  name: 'twitch-graphql',
  description: 'Twitch GraphQL API — streams, channels, categories, clips, schedules, follow',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('twitch.tv')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const hasAuth = await page.evaluate(() => document.cookie.includes('auth-token'))
    return Boolean(hasAuth)
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw OpenWebError.unknownOp(operation)
    }
    try {
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
