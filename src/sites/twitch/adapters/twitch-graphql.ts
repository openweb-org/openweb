import type { Page } from 'patchright'
import type { CodeAdapter } from '../../../types/adapter.js'
import { gqlFetch } from './queries.js'

async function searchChannels(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
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

async function getChannel(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? '')
  const data = (await gqlFetch(page, 'ChannelRoot_AboutPanel', {
    channelLogin,
    skipSchedule: false,
  })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  if (!user) return null

  const followers = user.followers as Record<string, unknown>
  const roles = user.roles as Record<string, unknown>
  const channel = user.channel as Record<string, unknown>
  const socials = (channel?.socialMedias ?? []) as Array<Record<string, unknown>>
  const schedule = channel?.schedule as Record<string, unknown>
  const nextSeg = schedule?.nextSegment as Record<string, unknown> | null

  return {
    id: user.id,
    displayName: user.displayName,
    description: user.description,
    profileImageURL: user.profileImageURL,
    primaryColorHex: user.primaryColorHex,
    followers: followers?.totalCount,
    isPartner: roles?.isPartner,
    isAffiliate: roles?.isAffiliate,
    socialMedias: socials.map((s) => ({ name: s.name, title: s.title, url: s.url })),
    nextScheduleSegment: nextSeg
      ? { startAt: nextSeg.startAt, title: nextSeg.title, hasReminder: nextSeg.hasReminder }
      : null,
  }
}

async function getStream(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const channelLogin = String(params.channelLogin ?? '')
  const data = (await gqlFetch(page, 'StreamMetadata', { channelLogin })) as Record<string, unknown>

  const user = data.user as Record<string, unknown>
  if (!user) return null

  const stream = user.stream as Record<string, unknown> | null
  const game = stream?.game as Record<string, unknown> | null
  const lastBroadcast = user.lastBroadcast as Record<string, unknown> | null

  return {
    id: user.id,
    profileImageURL: user.profileImageURL,
    primaryColorHex: user.primaryColorHex,
    isPartner: (user.roles as Record<string, unknown>)?.isPartner,
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

async function getTopGames(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const limit = Number(params.limit ?? 30)
  const sort = String(params.sort ?? 'VIEWER_COUNT')

  const data = (await gqlFetch(page, 'BrowsePage_AllDirectories', {
    limit,
    options: {
      recommendationsContext: { platform: 'web' },
      requestID: '',
      sort,
      tags: [],
    },
  })) as Record<string, unknown>

  const directories = data.directoriesWithTags as Record<string, unknown>
  const edges = (directories?.edges ?? []) as Array<Record<string, unknown>>

  return {
    categories: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      const tags = (node?.tags ?? []) as Array<Record<string, unknown>>
      return {
        id: node?.id,
        slug: node?.slug,
        displayName: node?.displayName,
        viewersCount: node?.viewersCount,
        broadcastersCount: node?.broadcastersCount,
        avatarURL: node?.avatarURL,
        tags: tags.map((t) => (t as Record<string, unknown>)?.localizedName),
      }
    }),
  }
}

const HANDLERS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchChannels,
  getChannel,
  getStream,
  getTopGames,
}

const adapter: CodeAdapter = {
  name: 'twitch-graphql',
  description: 'Twitch GraphQL API with persisted queries',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('twitch.tv')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // public data, no auth needed for reads
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = HANDLERS[operation]
    if (!handler) {
      throw Object.assign(new Error(`Unknown operation: ${operation}`), { failureClass: 'fatal' })
    }
    return handler(page, { ...params })
  },
}

export default adapter
