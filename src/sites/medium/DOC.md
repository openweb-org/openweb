# Medium

## Overview
Blogging and publishing platform. Content platform archetype. Search articles, browse topic feeds, discover curated lists, explore writers, view user profiles, clap articles, follow writers, and save bookmarks via Medium's GraphQL API.

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
1. `getTagWriters(tagSlug)` → writers/publications with `userId`
2. `getUserProfile(username)` → name, bio, followers

### Discover curated content
1. `getTagCuratedLists(tagSlug)` → staff-picked reading lists
2. Lists contain posts with `postId` → `getArticle(postId)`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search articles by keyword | query | title, subtitle, author, url | DOM extraction; entry point |
| getArticle | get full article detail | postId ← getTagFeed/searchArticles | title, author, claps, readingTime, isLocked | GraphQL PostDetailQuery |
| getTagFeed | latest articles for a tag | tagSlug | posts[], pageInfo | GraphQL; paginated |
| getTagCuratedLists | curated reading lists for a tag | tagSlug | lists[] with post items | GraphQL |
| getTagWriters | recommended writers for a tag | tagSlug, first?, after? | publishers[], pageInfo | GraphQL; paginated |
| getRecommendedFeed | trending/top articles | limit? | posts[] with feedId, reason | GraphQL; personalized when logged in |
| getRecommendedTags | trending topic tags | — | tags[] with slug | entry point |
| getPostClaps | clap count for a post | postId ← getTagFeed | postId, clapCount | GraphQL |
| getRecommendedWriters | writers to follow | — | publishers[] | GraphQL |
| getUserProfile | user/author profile | username | name, bio, followers, imageUrl | DOM extraction |
| clapArticle | clap (upvote) a post | postId | clapCount, viewerClapCount | SAFE write; requires auth |
| followWriter | follow a writer | userId ← getTagWriters | isFollowing | SAFE write; requires auth |
| saveArticle | save to reading list | postId | saved, catalogItemId | SAFE write; requires auth |

## Quick Start

```bash
# Search for articles
openweb medium exec searchArticles '{"query":"machine learning"}'

# Get articles for a topic
openweb medium exec getTagFeed '{"tagSlug":"programming"}'

# Get article detail
openweb medium exec getArticle '{"postId":"70d2a62246c0"}'

# Get user profile
openweb medium exec getUserProfile '{"username":"Netflix_TechBlog"}'

# Get trending tags
openweb medium exec getRecommendedTags '{}'
```

---

## Site Internals

## API Architecture
- **GraphQL-first**: Most data served through `medium.com/_/graphql` POST endpoint
- **Batched requests**: GraphQL operations sent as JSON arrays (single ops wrapped in array)
- **SSR for search/profiles**: Search results and user profiles rendered server-side, extracted via DOM
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

## Known Issues
- **Search uses DOM scraping**: Medium SSR-renders search results, no dedicated search GraphQL query. May break if layout changes.
- **User profile DOM scraping**: Profile data extracted from rendered page. Layout-dependent.
- **Paywall content**: `isLocked: true` articles have limited preview content.
- **Personalized feed**: `getRecommendedFeed` may return null when not logged in.
- **GraphQL typos**: Medium's schema contains `AddToPredefinedCatalogSucces` (missing 's') and `preprend` (misspelled) — adapter uses exact spellings.
