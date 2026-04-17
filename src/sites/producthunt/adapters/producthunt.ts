import type { Page } from 'patchright'

const PH_ORIGIN = 'https://www.producthunt.com'

interface ApolloCache { [key: string]: any }

async function extractApolloCache(page: Page): Promise<ApolloCache> {
  return page.evaluate(() => {
    const client = (window as any).__APOLLO_CLIENT__
    return client ? client.cache.extract() : {}
  })
}

function resolveRef(cache: ApolloCache, ref: any): any {
  if (ref && typeof ref === 'object' && '__ref' in ref) return cache[ref.__ref] ?? null
  return ref
}

function extractTagline(entry: any): string | null {
  if (!entry) return null
  if (entry.tagline) return entry.tagline
  const k = Object.keys(entry).find((x) => x.startsWith('tagline('))
  return k ? entry[k] : null
}

async function getPost(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const slug = params.slug
  if (!slug) throw new Error('slug parameter is required')

  await page.goto(`${PH_ORIGIN}/posts/${slug}`, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(3000)

  const cache = await extractApolloCache(page)

  let product: any = null
  let post: any = null
  for (const key of Object.keys(cache)) {
    const entry = cache[key]
    if (!entry) continue
    if (!product && entry.__typename === 'Product' && entry.slug === slug) product = entry
    if (!post && entry.__typename === 'Post' && entry.slug === slug) post = entry
    if (product && post) break
  }

  const makers: any[] = []
  for (const uk of Object.keys(cache).filter((k) => k.startsWith('User'))) {
    const u = cache[uk]
    if (u?.name) makers.push({ name: u.name, username: u.username ?? null, headline: u.headline ?? null })
  }

  const categories: string[] = []
  if (product?.categories) {
    for (const ref of product.categories) {
      const c = resolveRef(cache, ref)
      if (c?.name) categories.push(c.name)
    }
  }

  return {
    id: product?.id ?? post?.id ?? String(slug),
    name: product?.name ?? post?.name ?? String(slug),
    slug: product?.slug ?? post?.slug ?? String(slug),
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

const adapter = {
  name: 'producthunt',
  description: 'Product Hunt — getPost via Apollo cache (other ops in spec extraction)',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('producthunt.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: { unknownOp(op: string): Error } },
  ): Promise<unknown> {
    if (operation === 'getPost') return getPost(page, params)
    throw helpers.errors.unknownOp(operation)
  },
}

export default adapter
