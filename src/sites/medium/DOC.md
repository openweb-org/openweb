# Medium

## Overview
Blogging and publishing platform. Content platform archetype. Search articles, browse topic feeds, discover curated lists, explore writers, clap articles, follow writers, and save bookmarks via Medium's GraphQL API.

## Workflows

### Browse articles by topic
1. `getRecommendedTags` → pick tag → `tagSlug`
2. `getTagFeed(tagSlug)` → posts with `postId`
3. `getArticle(postId)` → full article detail

### Search and read
1. `searchArticles(query)` → results with titles, URLs
2. Pick article URL → extract `postId` from URL
3. `getArticle(postId)` → full detail

### Explore writers for a topic
1. `getTagWriters(tagSlug)` → writers/publications with `userId`, bio, follower count

### Discover curated content
1. `getTagCuratedLists(tagSlug)` → staff-picked reading lists
2. Lists contain posts with `postId` → `getArticle(postId)`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search articles by keyword | query | title, subtitle, url | DOM extraction; entry point |
| getArticle | get full article detail | postId ← getTagFeed/searchArticles | title, author, claps, readingTime, isLocked | GraphQL PostDetailQuery |
| getTagFeed | latest articles for a tag | tagSlug | posts[], pageInfo | GraphQL; paginated |
| getTagCuratedLists | curated reading lists for a tag | tagSlug | lists[] with post items | GraphQL |
| getTagWriters | recommended writers for a tag | tagSlug, first?, after? | publishers[], pageInfo | GraphQL; paginated |
| getRecommendedFeed | trending/top articles | limit? | posts[] with feedId, reason | GraphQL; personalized when logged in |
| getRecommendedTags | trending topic tags | — | tags[] with slug | entry point |
| getPostClaps | clap count for a post | postId ← getTagFeed | postId, clapCount | GraphQL |
| getRecommendedWriters | writers to follow | — | publishers[] | GraphQL |
| clapArticle | clap (upvote) a post | postId | clapCount, viewerClapCount | SAFE write; requires auth |
| followWriter | follow a writer | userId ← getTagWriters | isFollowing | SAFE write; requires auth |
| saveArticle | save to reading list | postId | saved, catalogItemId | SAFE write; requires auth |
| unfollowWriter | unfollow a writer | userId ← getTagWriters | isFollowing | CAUTION write; requires auth |
| unsaveArticle | remove from reading list | postId | removed | CAUTION write; requires auth |

## Quick Start

```bash
# Search for articles
openweb medium exec searchArticles '{"query":"machine learning"}'

# Get articles for a topic
openweb medium exec getTagFeed '{"tagSlug":"programming"}'

# Get article detail
openweb medium exec getArticle '{"postId":"70d2a62246c0"}'

# Get trending tags
openweb medium exec getRecommendedTags '{}'

# Get recommended writers
openweb medium exec getRecommendedWriters '{}'
```

---

## Site Internals

## API Architecture
- **GraphQL-first**: Most data served through `medium.com/_/graphql` POST endpoint
- **Batched requests**: GraphQL operations sent as JSON arrays (single ops wrapped in array)
- **SSR for search**: Search results rendered server-side, extracted via DOM
- **Apollo Client**: Frontend uses Apollo for state management and caching

## Auth
- Read operations work without auth
- Write operations (clap, follow, save) require `sid`/`uid` cookies (logged-in session)
- No CSRF token required for GraphQL queries or mutations
- Viewer ID for clap mutations resolved automatically via `viewer` query

## Transport
- `transport: page` — all operations use browser fetch via adapter
- GraphQL requires `Content-Type: application/json` header
- Responses are JSON arrays (one element per batched operation)
- **No `__NEXT_DATA__`**: Medium is not a Next.js site. No `_next/` assets, no `__NEXT_DATA__` script tag.
- **`__APOLLO_STATE__` on tag pages**: Tag pages (e.g., `/tag/programming`) embed Apollo SSR cache as `window.__APOLLO_STATE__` with ~15 Post objects. Article pages and search pages do not have it. Tag page HTML is also fetchable from node (HTTP 200).
- **GraphQL works from node**: The `/_/graphql` endpoint accepts standard (non-batched) `{ query, variables }` POST from node HTTP with Chrome UA — returns 200 with `{ data: ... }`. All read operations tested successfully. This means a Tier 7 (node direct) upgrade is feasible for read ops, but requires restructuring all operations away from the adapter pattern (Relay connection flattening, field renames) or accepting raw GraphQL response shapes.

## Known Issues
- **Search uses DOM scraping**: Medium SSR-renders search results, no dedicated search GraphQL query. Author field may contain clap/response icons instead of author name. May break if layout changes.
- **getUserProfile removed**: DOM scraping returned garbage (wrong name, boilerplate bio, empty followers). Adapter code retained for future GraphQL migration.
- **Paywall content**: `isLocked: true` articles have limited preview content.
- **Personalized feed**: `getRecommendedFeed` may return null when not logged in.
- **GraphQL typos**: Medium's schema contains `AddToPredefinedCatalogSucces` (missing 's') and `preprend` (misspelled) — adapter uses exact spellings.
