# Douban

## Overview
Chinese media review platform (movies, books, music). Chinese Web archetype — all data via DOM extraction, no JSON APIs.

## Quick Start

```bash
# Search movies by keyword
openweb douban exec searchMovies '{"query":"Inception"}'

# Get movie detail with rating, cast, synopsis
openweb douban exec getMovieDetail '{"id":3541415}'

# Get movie comments/reviews
openweb douban exec getMovieComments '{"id":3541415}'

# Get Douban Top 250 movies
openweb douban exec getTopMovies '{}'

# Search books by keyword
openweb douban exec searchBooks '{"query":"Python"}'

# Get book detail with rating, author, publisher
openweb douban exec getBookDetail '{"id":1084336}'

# Get book comments
openweb douban exec getBookComments '{"id":1084336}'
```

## Operations

| Operation | Intent | Transport | Notes |
|-----------|--------|-----------|-------|
| searchMovies | Search movies by keyword | adapter | search.douban.com, pagination via `start` param |
| getMovieDetail | Movie detail page | adapter | Uses JSON-LD + DOM, returns rating/cast/synopsis/genres |
| getMovieComments | Movie comments/reviews | adapter | 20 per page, star rating + vote count |
| getTopMovies | Top 250 chart | adapter | 25 per page, pagination via `start` (0, 25, 50...) |
| searchBooks | Search books by keyword | adapter | search.douban.com, pagination via `start` param |
| getBookDetail | Book detail page | adapter | Uses JSON-LD + DOM, returns rating/author/publisher/summary |
| getBookComments | Book comments | adapter | 20 per page, same structure as movie comments |

## API Architecture
Douban has **no public JSON APIs** for content. All data is server-side rendered HTML. The adapter navigates to each page via Playwright and extracts structured data from:
- **JSON-LD** (`script[type="application/ld+json"]`) — rich structured data for movie/book detail pages
- **DOM selectors** — ratings, comments, search results, top charts
- **Info text parsing** — book metadata (publisher, pages, price) from `#info` text block

Subdomains: `movie.douban.com`, `book.douban.com`, `search.douban.com`, `www.douban.com`.

## Auth
None required. All operations work on public data without login.

## Transport
Page transport (L3 adapter). All operations use the `douban-dom.ts` adapter which:
1. Navigates to the target URL via `page.goto()`
2. Extracts data via `page.evaluate()` with CSS selectors and JSON-LD parsing
3. Returns structured JSON

Server URL is `https://www.douban.com` to match any `*.douban.com` subdomain tab.

## Known Issues
- **Rate limiting**: Douban is aggressive about rate limiting. Space out requests.
- **Search results**: Book search can return author pages and series links (not just books), which have `id: null`.
- **No pagination metadata**: Search and comments don't return total count, only current page items.
- **ratingCount on comments page**: Not available from the comment listing DOM — only from the detail page.
