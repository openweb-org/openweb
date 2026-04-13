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
