# Goodreads

## Overview
World's largest book community (Amazon-owned). Search books, get book details with ratings and reviews, and explore author profiles.

## Workflows

### Find a book and read reviews
1. `searchBooks(q)` → pick result → `bookId`
2. `getBook(bookId)` → title, rating, description, genres
3. `getReviews(bookId)` → community reviews with ratings

### Explore an author's work
1. `searchBooks(q)` → pick result → `authorId`
2. `getAuthor(authorId)` → bio, bibliography with `bookId` per book
3. `getBook(bookId)` → full detail on any book

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchBooks | find books by title/author/ISBN | q | bookId, title, author, authorId, averageRating | entry point; 20 results/page |
| getBook | full book detail | bookId ← searchBooks | title, author, ratingValue, description, genres, pageCount, isbn | LD+JSON + DOM |
| getReviews | community reviews | bookId ← searchBooks | name, rating, text, date | up to 30 reviews from page |
| getAuthor | author profile + bibliography | authorId ← searchBooks | name, bio, born, books[] | books include bookId |

## Quick Start

```bash
# Search for a book
openweb goodreads exec searchBooks '{"q": "dune"}'

# Get book details
openweb goodreads exec getBook '{"bookId": "44767458-dune"}'

# Get reviews for a book
openweb goodreads exec getReviews '{"bookId": "44767458-dune"}'

# Get author profile
openweb goodreads exec getAuthor '{"authorId": "58.Frank_Herbert"}'
```

---

## Site Internals

### API Architecture
Traditional Rails SSR application for search and author pages. Book detail pages use Next.js
with Apollo GraphQL SSR — `__NEXT_DATA__` contains full `apolloState` with Book, Work,
Contributor, Series, Review, and User entities. No SPA client-side loading needed for data.

An autocomplete JSON endpoint exists at `/book/auto_complete?format=json&q=...` (5 results,
rich data) but the full search page (20 results/page) is used instead.

### Auth
No auth required for public data.

### Transport
`node` transport — all operations use direct HTTP fetch. No browser needed.
No bot detection on any endpoint (Cloudflare/DataDome/PerimeterX present but
do not challenge standard User-Agent requests).

### Extraction
All operations use the adapter (`adapters/goodreads.ts`) with the injected `nodeFetch` helper (SSRF + redirect + timeout guards) instead of raw `fetch()`. Adapter retained because `apolloState` post-processing is too site-specific for generic primitives:
- **searchBooks**: HTML regex parse of Rails search page (schema.org microdata rows)
- **getBook**: `__NEXT_DATA__` → `apolloState` JSON parse (Book + Work + Contributor entities)
- **getReviews**: `__NEXT_DATA__` → `apolloState` JSON parse (30 Review + User entities in SSR)
- **getAuthor**: HTML regex parse of Rails author page (schema.org microdata)

### Known Issues
- Author page shows top ~10 books; full bibliography requires pagination
- Search returns 20 results per page; total result count shown in header but not extracted
- Bio text may be truncated on author pages with long biographies
