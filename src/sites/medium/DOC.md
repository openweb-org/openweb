# Medium

## Overview
Blogging and publishing platform. Search articles, browse topic feeds, discover curated lists, explore publications, and view user profiles via Medium's GraphQL API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchArticles | search articles by keyword | DOM | navigates to search page, extracts from rendered HTML |
| getTagFeed | get latest articles for a topic/tag | GraphQL | newest posts for a tag slug; paginated |
| getTagCuratedLists | get curated reading lists for a tag | GraphQL | staff-picked article collections |
| getTagWriters | get recommended writers for a tag | GraphQL | users and publications; paginated |
| getRecommendedFeed | get personalized recommended articles | GraphQL | trending/top posts globally |
| getRecommendedTags | get trending topic tags | GraphQL | sidebar recommended tags |
| getPublicationPosts | get posts by ID (publication sections) | GraphQL | batch fetch by post IDs |
| getPostClaps | get clap count for a post | GraphQL | single post engagement metric |
| getRecommendedWriters | get recommended writers to follow | GraphQL | personalized writer suggestions |
| getUserProfile | get user/author profile | DOM | navigates to profile page, extracts from rendered HTML |

## API Architecture
- **GraphQL-first**: Most data served through `medium.com/_/graphql` POST endpoint
- **Batched requests**: GraphQL operations sent as JSON arrays (even single ops wrapped in array)
- **SSR for pages**: Search results and user profiles rendered server-side, not via separate API calls
- **Apollo Client**: Frontend uses Apollo for state management and caching
- No aggressive bot detection on GraphQL endpoint — browser context needed for cookies

## Auth
- Most operations work without auth (`requires_auth: false`)
- Logged-in users get personalized recommendations
- No CSRF token required for GraphQL queries
- Session tracked via `sid` and `uid` cookies

## Transport
- `transport: page` — browser fetch for all operations
- GraphQL requires `Content-Type: application/json` header
- Responses are JSON arrays (one element per batched operation)

## Extraction
- **Adapter-based**: All operations use the `medium-graphql` adapter
- GraphQL queries return structured JSON — no DOM parsing needed for most operations
- Search and user profile use page navigation + DOM extraction (SSR content)

## Known Issues
- **Search uses DOM scraping**: Medium SSR-renders search results, no dedicated search GraphQL query exposed
- **User profile DOM scraping**: Profile data extracted from rendered page, may break if layout changes
- **Paywall content**: `isLocked: true` articles have limited preview content
- **Rate limiting**: Medium may rate-limit heavy GraphQL usage
- **Personalized feed**: `getRecommendedFeed` returns different results based on login state
