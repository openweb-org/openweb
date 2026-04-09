# NPR (National Public Radio)

## Overview
Major U.S. public media news outlet. Public Algolia search index provides full article content including text, author, date, topics, and audio availability.

## Workflows

### Search for articles on a topic
1. `searchArticles(query)` → browse results → note article `objectID`
2. `getArticle(objectID)` → full article with complete body text

### Get today's top stories
1. `getTopStories()` → latest front-page stories with headlines and summaries
2. `getArticle(objectID)` → drill into a specific story for full text

### Research a topic
1. `searchArticles(query, hitsPerPage: 20)` → broad search results
2. Filter by topic using `filters: "type:story AND topics:\"Health\""` for section-specific results
3. `getArticle(objectID)` → read full articles of interest

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles by keyword | query | objectID, title, bodyText, bylines, displayDate | entry point, paginated (page 0-indexed) |
| getArticle | full article content | objectID ← searchArticles | bodyText (full), title, bylines, topics, image | body is plain text |
| getTopStories | latest front page stories | — | objectID, title, bodyText, displayDate, topics | pre-filtered to homepage stories |

## Quick Start

```bash
# Search for articles
openweb npr exec searchArticles '{"query": "artificial intelligence"}'

# Get a specific article (use objectID from search results)
openweb npr exec getArticle '{"objectID": "nx-s1-5777587"}'

# Get latest top stories
openweb npr exec getTopStories '{}'

# Search with pagination
openweb npr exec searchArticles '{"query": "economy", "hitsPerPage": 20, "page": 1}'
```

---

## Site Internals

## API Architecture
- NPR uses Algolia as its search backend with a public API key embedded in the site JavaScript
- Single Algolia index `nprorg-cds` contains all NPR content (stories, pages, transcripts)
- GET-based REST API at `7s4f1grybg-dsn.algolia.net`
- Article body text is stored directly in the Algolia index as plain text (not HTML)
- Search results include teaser/summary `bodyText`; single-object GET returns full `bodyText`

## Auth
No auth required. Public Algolia API key (`f2f5be631a4287148759373ff4ab5227`) and application ID (`7S4F1GRYBG`) are embedded as default query parameters.

## Transport
`node` — direct HTTP to Algolia API. No browser needed, no bot detection on the Algolia endpoint.

## Known Issues
- Article `bodyText` is plain text, not HTML. No paragraph/heading structure preserved.
- Some older or non-standard content (transcripts pages, corrections pages) appears in unfiltered searches. Use `filters: "type:story"` to exclude them.
- `bylines` array may contain null entries for wire/AP stories.
- Algolia pagination is 0-indexed (first page is `page: 0`), unlike most news APIs.
- `url` field is a relative path (e.g. `/2026/04/09/...`), not a full URL. Use `canonicalUrl` for the full URL, or prefix with `https://www.npr.org`.
- The `displayDate` object may be empty for non-article content types.
