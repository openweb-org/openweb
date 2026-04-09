import type { Page } from 'patchright'

const PH_ORIGIN = 'https://www.producthunt.com'

interface ApolloCache {
  [key: string]: any
}

async function extractApolloCache(page: Page): Promise<ApolloCache> {
  return page.evaluate(() => {
    const client = (window as any).__APOLLO_CLIENT__
    if (!client) return {}
    return client.cache.extract()
  })
}

function resolveRef(cache: ApolloCache, ref: any): any {
  if (ref && typeof ref === 'object' && '__ref' in ref) {
    return cache[ref.__ref] ?? null
  }
  return ref
}

function extractTagline(entry: any): string | null {
  if (entry.tagline) return entry.tagline
  const taglineKey = Object.keys(entry).find((k) => k.startsWith('tagline('))
  return taglineKey ? entry[taglineKey] : null
}

function extractTopics(cache: ApolloCache, entry: any): string[] {
  const topicsKey = Object.keys(entry).find((k) => k.startsWith('topics('))
  const topics = topicsKey ? entry[topicsKey] : null
  if (!topics?.edges) return []
  return topics.edges
    .map((e: any) => resolveRef(cache, e.node))
    .filter(Boolean)
    .map((t: any) => t.name)
}

function formatPost(cache: ApolloCache, post: any): any {
  const product = resolveRef(cache, post.product)
  return {
    id: post.id,
    name: post.name,
    slug: post.slug,
    tagline: extractTagline(post),
    votesCount: post.latestScore ?? 0,
    commentsCount: post.commentsCount ?? 0,
    dailyRank: post.dailyRank ?? null,
    createdAt: post.createdAt ?? null,
    featuredAt: post.featuredAt ?? null,
    thumbnailUrl: post.thumbnailImageUuid
      ? `https://ph-files.imgix.net/${post.thumbnailImageUuid}?auto=format&fit=crop&h=150&w=150`
      : null,
    topics: extractTopics(cache, post),
    productSlug: product?.slug ?? post.slug,
  }
}

async function getToday(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  await page.goto(PH_ORIGIN, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const cache = await extractApolloCache(page)
  const root = cache['ROOT_QUERY']
  if (!root) return []

  const todayKey = Object.keys(root).find(
    (k) => k.includes('homefeed') && k.includes('TODAY'),
  )
  if (!todayKey) return []

  const todayFeed = resolveRef(cache, root[todayKey])
  if (!todayFeed?.edges) return []

  const pages = todayFeed.edges
    .map((e: any) => resolveRef(cache, e.node))
    .filter(Boolean)
  const posts: any[] = []

  for (const feedPage of pages) {
    if (!feedPage.items) continue
    for (const itemRef of feedPage.items) {
      const item = resolveRef(cache, itemRef)
      if (!item || item.__typename !== 'Post') continue
      posts.push(formatPost(cache, item))
    }
  }

  return posts
}

async function getPosts(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const section = String(params.section ?? 'TODAY').toUpperCase()
  await page.goto(PH_ORIGIN, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const cache = await extractApolloCache(page)
  const root = cache['ROOT_QUERY']
  if (!root) return []

  const feedKey = Object.keys(root).find(
    (k) => k.includes('homefeed') && k.includes(section),
  )
  if (!feedKey) return []

  const feed = resolveRef(cache, root[feedKey])
  if (!feed?.edges) return []

  const pages = feed.edges
    .map((e: any) => resolveRef(cache, e.node))
    .filter(Boolean)
  const posts: any[] = []

  for (const feedPage of pages) {
    if (!feedPage.items) continue
    for (const itemRef of feedPage.items) {
      const item = resolveRef(cache, itemRef)
      if (!item || item.__typename !== 'Post') continue
      posts.push(formatPost(cache, item))
    }
  }

  return posts
}

async function getPost(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const slug = params.slug
  if (!slug) throw new Error('slug parameter is required')

  await page.goto(`${PH_ORIGIN}/posts/${slug}`, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const cache = await extractApolloCache(page)

  // Find product by slug
  let product: any = null
  for (const key of Object.keys(cache)) {
    const entry = cache[key]
    if (entry?.__typename === 'Product' && entry.slug === slug) {
      product = entry
      break
    }
  }

  // Find post by slug
  let post: any = null
  for (const key of Object.keys(cache)) {
    const entry = cache[key]
    if (entry?.__typename === 'Post' && entry.slug === slug) {
      post = entry
      break
    }
  }

  if (!product && !post) return null

  // Extract makers from the cache
  const makers: any[] = []
  const userKeys = Object.keys(cache).filter((k) => k.startsWith('User'))
  for (const uk of userKeys) {
    const user = cache[uk]
    if (user?.name) {
      makers.push({
        name: user.name,
        username: user.username ?? null,
        headline: user.headline ?? null,
      })
    }
  }

  // Extract categories
  const categories: string[] = []
  if (product?.categories) {
    for (const catRef of product.categories) {
      const cat = resolveRef(cache, catRef)
      if (cat?.name) categories.push(cat.name)
    }
  }

  return {
    id: product?.id ?? post?.id,
    name: product?.name ?? post?.name,
    slug: product?.slug ?? post?.slug,
    tagline: product?.tagline ?? extractTagline(post),
    description: product?.description ?? post?.description ?? null,
    websiteUrl: product?.websiteUrl ?? null,
    votesCount: post?.latestScore ?? 0,
    commentsCount: post?.commentsCount ?? 0,
    dailyRank: post?.dailyRank ?? null,
    createdAt: post?.createdAt ?? null,
    featuredAt: post?.featuredAt ?? null,
    followersCount: product?.followersCount ?? 0,
    reviewsCount: product?.reviewsCount ?? 0,
    reviewsRating: product?.reviewsRating ?? 0,
    categories,
    makers: makers.slice(0, 10),
    thumbnailUrl: post?.thumbnailImageUuid
      ? `https://ph-files.imgix.net/${post.thumbnailImageUuid}?auto=format&fit=crop&h=150&w=150`
      : null,
    logoUrl: product?.logoUuid
      ? `https://ph-files.imgix.net/${product.logoUuid}?auto=format&fit=crop&h=150&w=150`
      : null,
  }
}

async function searchProducts(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = params.query
  if (!query) throw new Error('query parameter is required')

  await page.goto(`${PH_ORIGIN}/search?q=${encodeURIComponent(String(query))}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await page.waitForTimeout(3000)

  const cache = await extractApolloCache(page)
  const root = cache['ROOT_QUERY']
  if (!root) return []

  // Find productSearch key
  const searchKey = Object.keys(root).find((k) => k.startsWith('productSearch('))
  if (!searchKey) return []

  const searchResult = root[searchKey]
  if (!searchResult?.edges) return []

  return searchResult.edges
    .map((edge: any) => {
      const product = resolveRef(cache, edge.node)
      if (!product) return null
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        tagline: product.tagline ?? null,
        reviewsRating: product.reviewsRating ?? 0,
        reviewsCount: product.reviewsCount ?? 0,
        logoUrl: product.logoUuid
          ? `https://ph-files.imgix.net/${product.logoUuid}?auto=format&fit=crop&h=150&w=150`
          : null,
      }
    })
    .filter(Boolean)
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>
> = {
  getToday,
  getPosts,
  getPost,
  searchProducts,
}

const adapter = {
  name: 'producthunt',
  description: 'Product Hunt — extract product data from Apollo Client cache',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('producthunt.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // Public data, no auth required
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: { unknownOp(op: string): Error } },
  ): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw helpers.errors.unknownOp(operation)
    }
    return handler(page, params)
  },
}

export default adapter
