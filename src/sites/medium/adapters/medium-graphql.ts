import type { Page } from 'patchright'
import {
  CLAP_MUTATION,
  EDIT_CATALOG_ITEMS_MUTATION,
  FOLLOW_USER_MUTATION,
  POST_CLAPS_QUERY,
  POST_DETAIL_QUERY,
  READING_LIST_ITEMS_QUERY,
  RECOMMENDED_FEED_QUERY,
  RECOMMENDED_TAGS_QUERY,
  RECOMMENDED_WRITERS_QUERY,
  SAVE_ARTICLE_MUTATION,
  TOPIC_CURATED_LISTS_QUERY,
  TOPIC_LATEST_STORIES_QUERY,
  TOPIC_WRITERS_QUERY,
  UNFOLLOW_USER_MUTATION,
  VIEWER_QUERY,
} from './queries.js'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Medium L3 adapter — GraphQL API via browser fetch.
 *
 * Medium serves data through a GraphQL endpoint at /_/graphql.
 * Requests are sent as arrays (batched). Most read operations work
 * without auth. Search results and profiles are extracted from the
 * rendered DOM (SSR content).
 */

const GRAPHQL_URL = 'https://medium.com/_/graphql'

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
  needsLogin(): Error
}

/* ---------- helpers ---------- */

async function graphqlFetch(
  page: Page,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  errors: { httpError(status: number): Error; apiError(label: string, msg: string): Error },
): Promise<unknown> {
  const payload = JSON.stringify([{ operationName, variables, query }])

  const result = await page.evaluate(
    async (args: { url: string; payload: string }) => {
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: args.payload,
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url: GRAPHQL_URL, payload },
  )

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text) as Array<{ data?: unknown; errors?: unknown[] }>
  const first = json[0]
  if (first?.errors) {
    const msg = (first.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw errors.apiError(operationName, msg)
  }

  return first?.data
}

/* ---------- operation handlers ---------- */

async function searchArticles(page: Page, params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const url = `https://medium.com/search?q=${encodeURIComponent(query)}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const articles = await page.evaluate(() => {
    const results: Array<Record<string, unknown>> = []
    const articleEls = document.querySelectorAll('article')
    for (const el of articleEls) {
      const titleEl = el.querySelector('h2')
      const subtitleEl = el.querySelector('h3')
      const linkEl = el.querySelector('a[href*="medium.com"], a[data-testid]')
      const authorEl = el.querySelector('p a, span a')
      const timeEl = el.querySelector('time')

      if (titleEl) {
        results.push({
          title: titleEl.textContent?.trim() ?? '',
          subtitle: subtitleEl?.textContent?.trim() ?? '',
          url: linkEl?.getAttribute('href') ?? '',
          author: authorEl?.textContent?.trim() ?? '',
          publishedAt: timeEl?.getAttribute('datetime') ?? '',
        })
      }
    }
    return results
  })

  return { query, articles, totalResults: articles.length }
}

async function getArticle(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const postId = String(params.postId ?? params.id ?? '')
  if (!postId) throw errors.missingParam('postId')

  const data = (await graphqlFetch(page, 'PostDetailQuery', POST_DETAIL_QUERY, {
    postId,
  }, errors)) as Record<string, unknown>

  return data.postResult ?? null
}

async function getTagFeed(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const tagSlug = String(params.tagSlug ?? params.tag ?? '')
  const data = (await graphqlFetch(page, 'TopicLatestStorieQuery', TOPIC_LATEST_STORIES_QUERY, {
    tagSlug,
  }, errors)) as Record<string, unknown>

  const tagData = data.tagFromSlug as Record<string, unknown>
  const posts = tagData?.posts as Record<string, unknown>
  const edges = (posts?.edges ?? []) as Array<Record<string, unknown>>

  return {
    tagSlug,
    posts: edges.map((e) => e.node),
    pageInfo: posts?.pageInfo,
  }
}

async function getTagCuratedLists(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const tagSlug = String(params.tagSlug ?? params.tag ?? '')
  const data = (await graphqlFetch(page, 'TopicCuratedListQuery', TOPIC_CURATED_LISTS_QUERY, {
    tagSlug,
  }, errors)) as Record<string, unknown>

  const tagData = data.tagFromSlug as Record<string, unknown>
  const curatedLists = tagData?.curatedLists as Record<string, unknown>
  const edges = (curatedLists?.edges ?? []) as Array<Record<string, unknown>>

  return {
    tagSlug,
    lists: edges.map((e) => e.node),
  }
}

async function getTagWriters(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const tagSlug = String(params.tagSlug ?? params.tag ?? '')
  const first = Number(params.first ?? 10)
  const after = params.after ? String(params.after) : ''

  const data = (await graphqlFetch(page, 'TopicWhoToFollowPubishersQuery', TOPIC_WRITERS_QUERY, {
    first,
    after,
    mode: 'ALL',
    tagSlug,
  }, errors)) as Record<string, unknown>

  const publishers = data.recommendedPublishers as Record<string, unknown>
  const edges = (publishers?.edges ?? []) as Array<Record<string, unknown>>

  return {
    tagSlug,
    publishers: edges.map((e) => e.node),
    pageInfo: publishers?.pageInfo,
  }
}

async function getRecommendedFeed(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const limit = Number(params.limit ?? 10)

  const data = (await graphqlFetch(page, 'WebInlineRecommendedFeedQuery', RECOMMENDED_FEED_QUERY, {
    forceRank: false,
    paging: { limit },
  }, errors)) as Record<string, unknown>

  const feed = data.webRecommendedFeed as Record<string, unknown>
  const items = (feed?.items ?? []) as Array<Record<string, unknown>>

  return {
    posts: items.map((item) => ({
      ...item.post as Record<string, unknown>,
      feedId: item.feedId,
      reason: item.reason,
    })),
    pagingInfo: feed?.pagingInfo,
  }
}

async function getRecommendedTags(page: Page, _params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const data = (await graphqlFetch(page, 'RightSidebarQuery', RECOMMENDED_TAGS_QUERY, {}, errors)) as Record<string, unknown>

  const tags = data.recommendedTags as Record<string, unknown>
  const edges = (tags?.edges ?? []) as Array<Record<string, unknown>>

  return {
    tags: edges.map((e) => {
      const node = e.node as Record<string, unknown>
      return {
        id: node.id,
        displayTitle: node.displayTitle,
        slug: node.normalizedTagSlug,
      }
    }),
  }
}

async function getPostClaps(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const postId = String(params.postId ?? params.id ?? '')
  const data = (await graphqlFetch(page, 'ClapCountQuery', POST_CLAPS_QUERY, {
    postId,
  }, errors)) as Record<string, unknown>

  const result = data.postResult as Record<string, unknown>
  return { postId: result?.id, clapCount: result?.clapCount }
}

async function getRecommendedWriters(page: Page, _params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const data = (await graphqlFetch(page, 'WhoToFollowModuleQuery', RECOMMENDED_WRITERS_QUERY, {}, errors)) as Record<
    string,
    unknown
  >

  const publishers = data.recommendedPublishers as Record<string, unknown>
  const edges = (publishers?.edges ?? []) as Array<Record<string, unknown>>

  return {
    publishers: edges.map((e) => e.node),
  }
}

async function getUserProfile(page: Page, params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const username = String(params.username ?? '')
  const url = `https://medium.com/@${username}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const profile = await page.evaluate(() => {
    const nameEl = document.querySelector('h2')
    const bioEl = document.querySelector('[class*="pw-subtitle"], [class*="bio"]') ??
      document.querySelectorAll('p')?.[0]
    const followerEl = Array.from(document.querySelectorAll('a, span')).find(
      (el) => el.textContent?.includes('Follower')
    )
    const imgEl = document.querySelector('img[alt][src*="miro.medium.com"]')

    return {
      name: nameEl?.textContent?.trim() ?? '',
      bio: bioEl?.textContent?.trim() ?? '',
      followers: followerEl?.textContent?.trim() ?? '',
      imageUrl: imgEl?.getAttribute('src') ?? '',
    }
  })

  return { username, ...profile }
}

/* ---------- write operation handlers ---------- */

async function getViewerId(page: Page, errors: Errors): Promise<string> {
  const data = (await graphqlFetch(page, 'ViewerQuery', VIEWER_QUERY, {}, errors)) as Record<string, unknown>
  const viewer = data.viewer as Record<string, unknown> | undefined
  if (!viewer?.id) throw errors.needsLogin()
  return String(viewer.id)
}

async function clapArticle(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const postId = String(params.postId ?? params.id ?? '')
  if (!postId) throw errors.missingParam('postId')
  const numClaps = Number(params.numClaps ?? 1)

  const userId = await getViewerId(page, errors)
  const data = (await graphqlFetch(page, 'ClapMutation', CLAP_MUTATION, {
    targetPostId: postId,
    userId,
    numClaps,
  }, errors)) as Record<string, unknown>

  const result = data.clap as Record<string, unknown>
  return {
    postId: result?.id,
    clapCount: result?.clapCount,
    viewerClapCount: (result?.viewerEdge as Record<string, unknown>)?.clapCount,
  }
}

async function followWriter(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId ?? params.id ?? '')
  if (!userId) throw errors.missingParam('userId')

  const data = (await graphqlFetch(page, 'FollowUserMutation', FOLLOW_USER_MUTATION, {
    userId,
  }, errors)) as Record<string, unknown>

  const result = data.followUser as Record<string, unknown>
  const viewerEdge = result?.viewerEdge as Record<string, unknown> | undefined
  return {
    userId: result?.id,
    name: result?.name,
    username: result?.username,
    isFollowing: viewerEdge?.isFollowing,
  }
}

async function saveArticle(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const postId = String(params.postId ?? params.id ?? '')
  if (!postId) throw errors.missingParam('postId')

  const data = (await graphqlFetch(page, 'AddToPredefinedCatalog', SAVE_ARTICLE_MUTATION, {
    type: 'READING_LIST',
    operation: { preprend: { type: 'POST', id: postId } },
  }, errors)) as Record<string, unknown>

  const result = data.addToPredefinedCatalog as Record<string, unknown>
  const item = result?.insertedItem as Record<string, unknown> | undefined
  return {
    postId,
    catalogItemId: item?.catalogItemId,
    saved: result?.__typename === 'AddToPredefinedCatalogSucces',
  }
}

async function unfollowWriter(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId ?? params.id ?? '')
  if (!userId) throw errors.missingParam('userId')

  const data = (await graphqlFetch(page, 'UnfollowUserMutation', UNFOLLOW_USER_MUTATION, {
    userId,
  }, errors)) as Record<string, unknown>

  const result = data.unfollowUser as Record<string, unknown>
  const viewerEdge = result?.viewerEdge as Record<string, unknown> | undefined
  return {
    userId: result?.id,
    name: result?.name,
    username: result?.username,
    isFollowing: viewerEdge?.isFollowing,
  }
}

async function unsaveArticle(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const postId = String(params.postId ?? params.id ?? '')
  if (!postId) throw errors.missingParam('postId')

  const userId = await getViewerId(page, errors)

  const listData = (await graphqlFetch(page, 'ReadingListItemsQuery', READING_LIST_ITEMS_QUERY, {
    userId,
    limit: 250,
  }, errors)) as Record<string, unknown>

  const catalog = listData.getPredefinedCatalog as Record<string, unknown> | undefined
  if (!catalog || catalog.__typename !== 'Catalog') {
    return { postId, removed: false, reason: 'reading_list_unavailable' }
  }
  const catalogId = String(catalog.id)
  const version = String(catalog.version)
  const itemsConnection = catalog.itemsConnection as Record<string, unknown> | undefined
  const items = (itemsConnection?.items ?? []) as Array<Record<string, unknown>>

  const matches = items.filter((it) => {
    const entity = it.entity as Record<string, unknown> | undefined
    return entity?.__typename === 'Post' && entity.id === postId
  })

  if (matches.length === 0) {
    return { postId, removed: false, reason: 'not_in_reading_list' }
  }

  const operations = matches.map((it) => ({ delete: { itemId: String(it.catalogItemId) } }))
  const editData = (await graphqlFetch(page, 'EditCatalogItems', EDIT_CATALOG_ITEMS_MUTATION, {
    catalogId,
    version,
    operations,
  }, errors)) as Record<string, unknown>

  const result = editData.editCatalogItems as Record<string, unknown>
  return {
    postId,
    removed: result?.__typename === 'EditCatalogItemsSuccess',
    removedCount: matches.length,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchArticles,
  getArticle,
  getTagFeed,
  getTagCuratedLists,
  getTagWriters,
  getRecommendedFeed,
  getRecommendedTags,
  getPostClaps,
  getRecommendedWriters,
  getUserProfile,
  clapArticle,
  followWriter,
  saveArticle,
  unfollowWriter,
  unsaveArticle,
}

const adapter: CustomRunner = {
  name: 'medium-graphql',
  description: 'Medium GraphQL API — articles, tags, publications, profiles',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as { errors: Errors }
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw errors.unknownOp(operation)
    }
    return handler(page as Page, { ...params }, errors)
  },
}

export default adapter
