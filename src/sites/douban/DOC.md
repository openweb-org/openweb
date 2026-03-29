# Douban

## Overview
Chinese media review/rating platform (movies, books, music). 14 operations across movies, books, music, and discovery — uses mobile JSON API via page transport for most operations, with DOM adapter fallback for music and desktop-only features.

## Quick Start

```bash
# Search movies
openweb douban exec searchMovies '{"q": "肖申克的救赎"}'

# Get movie detail by ID
openweb douban exec getMovie '{"id": 1292052}'

# Get movie cast/crew
openweb douban exec getMovieCelebrities '{"id": 1292052}'

# Search books
openweb douban exec searchBooks '{"q": "三体"}'

# Get book detail by ID
openweb douban exec getBook '{"id": 2567698}'

# Get trending movies
openweb douban exec getRecentHotMovies '{"limit": 20}'

# Get Top 250 (adapter)
openweb douban exec getTop250 '{"start": 0}'

# Search music (adapter)
openweb douban exec searchMusic '{"query": "周杰伦"}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchMovies | Search movies by keyword | GET /rexxar/api/v2/search/movie | Mobile JSON API |
| getMovie | Get movie detail | GET /rexxar/api/v2/movie/{id} | Full detail: rating, cast, summary, trailers |
| getMovieReviews | Get movie user reviews | GET /rexxar/api/v2/movie/{id}/interests | Paginated reviews with rating |
| getMovieCelebrities | Get movie cast/crew | GET /rexxar/api/v2/movie/{id}/celebrities | Directors, actors with roles |
| getMoviePhotos | Get movie photo gallery | Adapter: douban-dom | Stills, posters, wallpapers (desktop DOM) |
| getTop250 | Get Douban Top 250 movies | Adapter: douban-dom | Classic ranking, paginated by 25 |
| searchBooks | Search books by keyword | GET /rexxar/api/v2/search/book | Mobile JSON API |
| getBook | Get book detail | GET /rexxar/api/v2/book/{id} | Full detail: rating, author, summary |
| getBookReviews | Get book user reviews | GET /rexxar/api/v2/book/{id}/interests | Paginated reviews with rating |
| searchMusic | Search music/albums | Adapter: douban-dom | Desktop DOM extraction |
| getMusicDetail | Get album detail | Adapter: douban-dom | Artist, tracklist, genre (desktop DOM) |
| getRecentHotMovies | Get trending movies | GET /rexxar/api/v2/subject/recent_hot/movie | Currently popular films |
| getRecentHotTv | Get trending TV shows | GET /rexxar/api/v2/subject/recent_hot/tv | Currently popular TV series |
| getNowShowingMovies | Get now showing movies | GET /rexxar/api/v2/subject_collection/movie_showing/items | Films in theaters |

## API Architecture
Two data sources:

1. **Mobile JSON API** (primary) — `m.douban.com/rexxar/api/v2/`. RESTful JSON, requires browser context (Referer/Origin validation). Used for movies, books, trending, and now-showing operations.

2. **Desktop DOM extraction** (adapter) — `movie.douban.com`, `book.douban.com`, `music.douban.com`, `search.douban.com`. HTML pages scraped via Playwright adapter. Used for music operations, movie photos, and Top 250 — features not available in the mobile API.

## Auth
- No auth required for all operations — all return public content
- `requires_auth: false`
- Auth cookie `dbcl2` detected by adapter for future authenticated operations

## Transport
Page transport required. Both the mobile API and desktop sites validate request origin — only works from within browser context. Node transport returns 400/403.

## Adapters
- **douban-dom** — DOM extraction adapter for desktop Douban pages. Covers: searchMusic, getMusicDetail, getMoviePhotos, getTop250. Source: `adapters/douban-dom.ts`.

## Known Issues
- Rate limiting: Chinese sites are aggressive about rate limits
- Content is zh-CN only
- Desktop pages have no JSON API — adapter operations extract from HTML
- Search results return subject IDs usable with getMovie/getBook/getMusicDetail
- Mobile API (m.douban.com) has no music endpoints — music only via desktop adapter
