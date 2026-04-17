# Product Hunt

## Overview
Product discovery platform — daily curated tech products, tools, and startups with community voting.

## Workflows

### Browse today's featured products
1. `getToday` → today's featured products with name, tagline, votes, rank

### Search and explore products
1. `searchProducts(query)` → results with `slug`
2. `getPost(slug)` → full product details, description, makers

### Browse posts by time section
1. `getPosts(section)` → featured posts (TODAY, YESTERDAY, LAST_WEEK, LAST_MONTH)
2. `getPost(slug)` → full details for any post

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getToday | today's featured products | — | name, tagline, votesCount, dailyRank, topics | entry point |
| getPosts | featured posts by section | section? (TODAY default) | name, tagline, votesCount, dailyRank | entry point, supports YESTERDAY/LAST_WEEK/LAST_MONTH |
| getPost | product details | slug ← getPosts/searchProducts | name, description, votesCount, makers, categories | |
| searchProducts | find products by keyword | query | name, tagline, reviewsRating, slug | |

## Quick Start

```bash
# Today's featured products
openweb producthunt exec getToday '{}'

# Yesterday's top products
openweb producthunt exec getPosts '{"section": "YESTERDAY"}'

# Search for products
openweb producthunt exec searchProducts '{"query": "ai"}'

# Get a specific product's details
openweb producthunt exec getPost '{"slug": "novavoice"}'
```

---

## Site Internals

### API Architecture
- Next.js App Router with Apollo Client (GraphQL)
- GraphQL endpoint: `/frontend/graphql` (persisted queries only, no ad-hoc queries)
- All data available in Apollo Client cache after SSR hydration
- Homepage product listings are server-rendered, not fetched via client-side API
- Search uses `productSearch` query (SSR'd on `/search?q=...`)
- Post detail uses `ProductsPageLayout` persisted query

### Auth
No auth required for all read operations. Public data only.

### Transport
- `page` for all 4 ops
- **Hybrid**: 3 of 4 ops use spec `x-openweb.extraction` (`page_global_data` reading the Apollo Client cache via `__APOLLO_CLIENT__.cache.extract()`). `getPost` stays on the thin `producthunt` adapter — a single expression couldn't reliably resolve product/post/maker/category refs across the cache for individual post pages.

### Extraction
- `getToday` → `page_global_data`: Apollo cache, filter `__typename === 'Post'` for today's section
- `getPosts` → `page_global_data`: Apollo cache, filter posts by section (TODAY/YESTERDAY/LAST_WEEK/LAST_MONTH)
- `searchProducts` → `page_global_data`: Apollo cache, filter `__typename === 'Product'` matching the query
- `getPost` → adapter: Apollo cache walk + `__ref` resolution to merge Product, Post, makers (User entries), and categories

### Adapter Patterns
- `getPost` — needs cross-entity resolution (Product + Post by slug, makers from User entries, categories via `__ref` lookup). Kept in adapter because resolving Apollo's normalized cache references inline in a `page_global_data` expression was fragile.

### Known Issues
- No bot detection observed
- Product makers list on detail page includes all users loaded on the page (may include non-makers like commenters)
- Persisted query hashes change with deployments — do not hardcode
- Homepage shows a max of ~10-15 products per section from initial SSR load
