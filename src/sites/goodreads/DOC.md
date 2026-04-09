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

## API Architecture
Traditional Rails SSR application. No SPA framework (no Next.js, no React SSR).
Book detail pages include LD+JSON (`schema.org/Book`) with structured metadata.
An AWS AppSync GraphQL API exists (used for reviews, genres, similar books) but
is secondary to the SSR HTML. All data is extractable from the rendered DOM.

## Auth
No auth required for public data. `cookie_session` configured at server level
for future write operations. Session cookie `_session_id2` is present but not
needed for reads.

## Transport
`page` transport required for all operations. Heavy bot detection:
- Cloudflare (cf_clearance cookies)
- DataDome (datadome cookie)
- PerimeterX (_px3 cookie)

Node transport will fail. Browser must be headed with a real Chrome profile.

## Extraction
All operations except getReviews use `page_global_data` extraction with inline JavaScript:
- **searchBooks**: Parses `tr[itemtype="http://schema.org/Book"]` microdata rows
- **getBook**: Combines LD+JSON (`script[type="application/ld+json"]`) with DOM selectors for genres, description, series
- **getReviews**: Adapter (`adapters/goodreads.ts`) — reviews load asynchronously via GraphQL, requiring waitForSelector before DOM extraction
- **getAuthor**: Parses author page DOM with schema.org microdata for bibliography

## Known Issues
- Heavy bot detection may occasionally trigger challenges on rapid sequential requests
- Reviews extracted from initial page load only (no pagination/infinite scroll)
- Author page shows top ~10 books; full bibliography requires pagination
- Search returns 20 results per page; total result count shown in header but not extracted
