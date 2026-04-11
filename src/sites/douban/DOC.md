# Douban

## Overview
Chinese media review/rating platform (movies, books, music). Social/media archetype — 14 operations across movies, books, music, and discovery via mobile JSON API.

## Workflows

### Find and explore a movie
1. `searchMovies(q)` → pick result → `target.id`
2. `getMovie(id)` → full detail (rating, summary, cast overview)
3. `getMovieCelebrities(id)` → directors, actors with roles
4. `getMovieReviews(id)` → user reviews with ratings
5. `getMoviePhotos(id)` → stills, posters with dimensions

### Find and explore a book
1. `searchBooks(q)` → pick result → `target.id`
2. `getBook(id)` → full detail (rating, author, summary)
3. `getBookReviews(id)` → user reviews with ratings

### Discover trending content
1. `getRecentHotMovies()` → trending movies → `id`
2. `getRecentHotTv()` → trending TV shows → `id`
3. `getNowShowingMovies()` → in-theater movies → `id`
4. `getTop250(start)` → all-time top movies with rank

### Find music
1. `searchMusic(q)` → pick result → `target.id`
2. `getMusicDetail(id)` → album detail, tracklist, singer

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMovies | search movies | q | target.id, title, rating, year | entry point |
| getMovie | movie detail | id ← searchMovies | title, rating, genres, intro, directors, actors | |
| getMovieReviews | movie user reviews | id ← searchMovies | comment, rating, user.name, vote_count | paginated (count, start) |
| getMovieCelebrities | movie cast/crew | id ← searchMovies | directors[], actors[] with name, character, latin_name | |
| getMoviePhotos | movie photo gallery | id ← searchMovies | photos[].image.large.url, dimensions | paginated (count, start) |
| getTop250 | top 250 movies | start (optional) | rank_value, title, rating, description | paginated by 25 |
| searchBooks | search books | q | target.id, title, rating, card_subtitle | entry point |
| getBook | book detail | id ← searchBooks | title, rating, intro, author_intro, pubdate | |
| getBookReviews | book user reviews | id ← searchBooks | comment, rating, user.name, vote_count | paginated (count, start) |
| searchMusic | search music | q | target.id, title, rating, card_subtitle | entry point |
| getMusicDetail | album detail | id ← searchMusic | title, singer[], songs[], genres[], pubdate | |
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

# Get movie photos
openweb douban exec getMoviePhotos '{"id": 1292052, "count": 10}'

# Search books
openweb douban exec searchBooks '{"q": "三体"}'

# Get book detail
openweb douban exec getBook '{"id": 2567698}'

# Trending movies right now
openweb douban exec getRecentHotMovies '{"limit": 20}'

# Movies in theaters
openweb douban exec getNowShowingMovies '{"count": 10}'

# Top 250
openweb douban exec getTop250 '{"start": 0, "count": 25}'

# Search music
openweb douban exec searchMusic '{"q": "周杰伦"}'

# Get album detail
openweb douban exec getMusicDetail '{"id": 1401853}'
```

---

## Site Internals

## API Architecture
Single data source: **Mobile JSON API** (`m.douban.com/rexxar/api/v2/`). RESTful JSON, requires `Referer: https://m.douban.com/` header. All 14 operations use this API directly via node transport.

## Auth
- Auth type: `cookie_session`
- No login required — all operations return public content
- `requires_auth: false`

## Transport
Node transport for all operations. Only requires `Referer: https://m.douban.com/` header — no browser, no cookies, no signing needed for public data.

## Known Issues
- Rate limiting: Douban is aggressive about rate limits — space requests
- Content is zh-CN only
- Movie/book IDs from search results are in `target.id` (string), detail endpoints accept integer
- Music search parameter is `q` (consistent with movie/book search)
