# Douban

## Overview
Chinese media review/rating platform (movies, books, music). Social/media archetype — 14 operations across movies, books, music, and discovery via mobile JSON API and DOM adapters.

## Workflows

### Find and explore a movie
1. `searchMovies(q)` → pick result → `target.id`
2. `getMovie(id)` → full detail (rating, summary, cast overview)
3. `getMovieCelebrities(id)` → directors, actors with roles
4. `getMovieReviews(id)` → user reviews with ratings
5. `getMoviePhotos(id)` → stills, posters (adapter)

### Find and explore a book
1. `searchBooks(q)` → pick result → `target.id`
2. `getBook(id)` → full detail (rating, author, summary)
3. `getBookReviews(id)` → user reviews with ratings

### Discover trending content
1. `getRecentHotMovies()` → trending movies → `id`
2. `getRecentHotTv()` → trending TV shows → `id`
3. `getNowShowingMovies()` → in-theater movies → `id`
4. `getTop250(start)` → all-time top movies (adapter)

### Find music
1. `searchMusic(query)` → pick result → `subjectId`
2. `getMusicDetail(id)` → album detail, tracklist (adapter)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMovies | search movies | q | target.id, title, rating, year | entry point |
| getMovie | movie detail | id ← searchMovies | title, rating, genres, intro, directors, actors | |
| getMovieReviews | movie user reviews | id ← searchMovies | comment, rating, user.name, vote_count | paginated (count, start) |
| getMovieCelebrities | movie cast/crew | id ← searchMovies | directors[], actors[] with name, character, latin_name | |
| getMoviePhotos | movie photo gallery | id ← searchMovies | photos[].imageUrl | adapter (douban-dom) |
| getTop250 | top 250 movies | start (optional) | rank, title, rating, quote | adapter, paginated by 25 |
| searchBooks | search books | q | target.id, title, rating, card_subtitle | entry point |
| getBook | book detail | id ← searchBooks | title, rating, intro, author_intro, pubdate | |
| getBookReviews | book user reviews | id ← searchBooks | comment, rating, user.name, vote_count | paginated (count, start) |
| searchMusic | search music | query | subjectId, title, rating, meta | entry point, adapter (douban-dom) |
| getMusicDetail | album detail | id ← searchMusic | title, artist, genre, tracks[], releaseDate | adapter (douban-dom) |
| getRecentHotMovies | trending movies | limit (optional) | id, title, rating, year | entry point |
| getRecentHotTv | trending TV shows | limit (optional) | id, title, rating, episodes_info | entry point |
| getNowShowingMovies | in-theater movies | count (optional) | id, title, rating, release_date | entry point |

## Quick Start

```bash
# Search for a movie and get its ID
openweb douban exec searchMovies '{"q": "肖申克的救赎"}'

# Get movie detail by ID (from search results target.id)
openweb douban exec getMovie '{"id": 1292052}'

# Get movie cast and crew
openweb douban exec getMovieCelebrities '{"id": 1292052}'

# Get movie reviews
openweb douban exec getMovieReviews '{"id": 1292052, "count": 10}'

# Search books
openweb douban exec searchBooks '{"q": "三体"}'

# Get book detail
openweb douban exec getBook '{"id": 2567698}'

# Trending movies right now
openweb douban exec getRecentHotMovies '{"limit": 20}'

# Movies in theaters
openweb douban exec getNowShowingMovies '{"count": 10}'

# Top 250 (adapter — needs browser)
openweb douban exec getTop250 '{"start": 0}'

# Search music (adapter — needs browser)
openweb douban exec searchMusic '{"query": "周杰伦"}'
```

---

## Site Internals

## API Architecture
Two data sources:

1. **Mobile JSON API** (primary) — `m.douban.com/rexxar/api/v2/`. RESTful JSON, requires browser context (Referer/Origin validation). Used for movies, books, trending, and now-showing operations.

2. **Desktop DOM extraction** (adapter) — `movie.douban.com`, `search.douban.com`, `music.douban.com`. HTML pages scraped via Playwright adapter. Used for music operations, movie photos, and Top 250 — features not available in the mobile API.

## Auth
- Auth type: `cookie_session`
- No login required — all operations return public content
- Auth cookie `dbcl2` detected by adapter for potential future authenticated operations
- `requires_auth: false`

## Transport
Page transport required for all operations. Both the mobile API and desktop sites validate request origin — node transport returns 400/403. Adapter operations navigate directly to desktop Douban pages.

## Extraction
- Mobile API: direct JSON response (no extraction needed)
- Adapter ops (getMoviePhotos, getTop250, searchMusic, getMusicDetail): DOM extraction via `douban-dom.ts` adapter using Playwright `page.evaluate()`

## Known Issues
- Rate limiting: Douban is aggressive about rate limits — space requests
- Content is zh-CN only
- Desktop pages have no JSON API — adapter operations extract from HTML (fragile to DOM changes)
- Mobile API has no music endpoints — music only via desktop adapter
- Adapter ops require managed browser (`openweb browser start`)
- Movie/book IDs from search results are in `target.id` (string), detail endpoints accept integer
