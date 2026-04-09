# The Guardian

## Overview
Major UK/international news outlet. Open public REST API at content.guardianapis.com for searching articles, fetching full content, and browsing section feeds.

## Workflows

### Search for articles on a topic
1. `searchArticles(q)` → browse results → note article `id`
2. `getArticle(ids)` → full article with body, byline, date

### Browse latest news in a section
1. `getSectionFeed(section)` → latest articles in a section (world, technology, business, etc.)
2. `getArticle(ids)` → drill into a specific article for full body

### Research a topic across sections
1. `searchArticles(q, order-by: newest)` → recent coverage
2. `getSectionFeed(section)` → compare coverage across sections

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles by keyword | q | id, webTitle, sectionId, webPublicationDate, fields | entry point, paginated |
| getArticle | full article content | ids ← searchArticles.id | fields.body, fields.headline, fields.byline | body is HTML |
| getSectionFeed | latest in a section | section | id, webTitle, webPublicationDate, fields | defaults to newest first |

## Quick Start

```bash
# Search for articles
openweb guardian exec searchArticles '{"q": "artificial intelligence"}'

# Get a specific article (use id from search results)
openweb guardian exec getArticle '{"ids": "technology/2025/dec/10/police-facial-recognition-technology-bias"}'

# Get latest technology articles
openweb guardian exec getSectionFeed '{"section": "technology"}'

# Get latest world news
openweb guardian exec getSectionFeed '{"section": "world"}'
```

---

## Site Internals

## API Architecture
- Public REST API at `content.guardianapis.com`
- All responses wrapped in `{response: {status, total, results: [...]}}`
- Single article responses use `{response: {status, content: {...}}}`
- `show-fields` parameter controls which content fields are included in results

## Auth
API key passed as `api-key` query parameter. The key `test` works for development with low rate limits. No signup required for basic usage.

## Transport
`node` — direct HTTP. Public JSON API, no bot detection, no browser needed.

## Known Issues
- The `test` API key has low rate limits (~12 calls/minute). Register for a free key at open-platform.theguardian.com for higher limits.
- Article body (`fields.body`) is raw HTML, not plain text.
- Some older articles may have null byline or thumbnail fields.
- Section slugs use hyphens (e.g. `uk-news`, `us-news`), not underscores.
