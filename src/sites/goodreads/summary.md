# Goodreads — Discovery & Implementation

## Final Architecture

- **All 4 ops**: Pure node HTTP fetch — zero browser dependency
- **searchBooks**: HTML regex parse of Rails search page (schema.org `Book` microdata rows, 20/page)
- **getBook**: `__NEXT_DATA__` → `apolloState` parse from Next.js book detail page (Book + Work + Contributor + Series entities)
- **getReviews**: `__NEXT_DATA__` → `apolloState` parse (30 Review + User entities pre-rendered in SSR)
- **getAuthor**: HTML regex parse of Rails author page (schema.org `Person` microdata)
- **Zero DOM**: no CSS selectors, no browser JavaScript execution, no page navigation
- **No bot detection**: despite Cloudflare/DataDome/PerimeterX cookies present, no challenge is issued to standard User-Agent requests

## Discovery Journey

### Phase 0: Original State

All 4 ops used `page` transport with browser:
- `searchBooks`, `getBook`, `getAuthor`: inline `page_global_data` extraction expressions (DOM `querySelector` + `textContent`)
- `getReviews`: adapter with `page.goto()` → `waitForSelector('[data-testid="name"]')` → `page.evaluate()` DOM parse

Fragility points:
- 15+ CSS selectors across ops (`.BookPage__bookCover`, `.RatingStatistics__rating`, `.ContributorLinksList`, etc.)
- `getReviews` assumed async GraphQL review loading required `waitForSelector` + 1s delay
- `getAuthor` selectors like `.aboutAuthorInfo span[id*="freeText"]` were implementation-detail-dependent
- Any Goodreads UI refresh would break multiple ops simultaneously

### Phase 1: Network Probe

Captured network traffic during page loads via CDP headed browser:

**Search page** — zero JSON API calls. All content is Rails SSR HTML. Only ad trackers (Amazon Ads, DataDome, Pubmatic, etc.) in network log.

**Book detail page** — only `/weblab` A/B testing calls (return treatment variant flags). No GraphQL or REST API calls for content. Reviews are NOT loaded asynchronously — they're pre-rendered in SSR.

**Author page** — same as search: pure Rails SSR, no API calls.

### Phase 2: Fetch & Webpack Probes

**Fetch probe**: `window.fetch.toString().length = 34` — native fetch, not monkey-patched. No client-side signing.

**Webpack probe**: `webpackChunk_N_E` present (standard Next.js). But only book detail pages use Next.js — search and author pages are old Rails.

**Global probes** (key discoveries):
- `__NEXT_DATA__` exists on book pages with `apolloState` containing 73 entities
- `__APOLLO_CLIENT__` exists on book pages (18 keys including `query`, `mutate`, `cache`)
- Search page: NO `__NEXT_DATA__`, no React root, no Apollo — pure Rails
- Author page: NO `__NEXT_DATA__`, no React root — pure Rails with `body.desktop` class

### Phase 3: `__NEXT_DATA__` Deep Dive (The Breakthrough)

Fetched book page HTML from **pure node** (no browser) and found:

```
__NEXT_DATA__.props.pageProps.apolloState
├── Book:kca://...  — title, titleComplete, description, imageUrl, genres[], details{numPages, format, isbn13, publisher, language}
├── Work:kca://...  — stats{averageRating, ratingsCount, textReviewsCount}, details{awardsWon[], places[], characters[], publicationTime}
├── Contributor:kca://...  — name, legacyId, description, profileImageUrl, webUrl
├── Series:kca://...  — title, webUrl
├── Review:kca://... (×30) — text, rating, likeCount, commentCount, createdAt, spoilerStatus
└── User:... (×30) — name, imageUrlSquare, webUrl, isAuthor
```

**This is richer data than DOM extraction ever provided.** Awards, characters, places, publication dates, ISBN-13, like counts on reviews, user profile URLs — none of these were in the original DOM extraction.

### Phase 4: Node Fetch Validation

Tested all 4 page types from pure node `fetch()` with standard User-Agent:

| Endpoint | Status | Bot Detection | Data Available |
|----------|--------|---------------|----------------|
| `/search?q=dune` | 200 | None | 20 books with schema.org microdata |
| `/book/show/44767458-dune` | 200 | None | Full `__NEXT_DATA__` with apolloState |
| `/author/show/58.Frank_Herbert` | 200 | None | Rails HTML with microdata |
| `/book/auto_complete?format=json&q=dune` | 200 | None | JSON array (5 results, rich data) |

**Zero bot detection on any endpoint.** The DOC.md previously claimed "Node transport will fail. Browser must be headed with a real Chrome profile." — this was wrong. A standard User-Agent header is sufficient.

### Phase 5: Decision

```
Node direct ✓  — all 4 endpoints return full data with node fetch
  No bot detection barriers
  No client-side signing
  No auth requirements
  → Node transport for all ops (maximum stability, maximum speed)
```

**Rejected alternatives:**
- `page.evaluate(fetch)`: unnecessary — node works fine, no browser overhead
- Apollo client query: failed with `__name` polyfill error, and unnecessary since `__NEXT_DATA__` has all data in SSR
- `/book/auto_complete?format=json`: rich JSON API but only returns 5 results vs 20 for HTML search. Could be used as supplementary fast-path in future.
- GraphQL endpoint (`/graphql`): returns 502 — not publicly accessible

## Implementation

### searchBooks
HTML regex parse of Rails search page. Extracts from `<tr itemscope itemtype="http://schema.org/Book">` rows:
- Title from `<span itemprop='name'>`
- Author from `<a class="authorName">` → `<span itemprop="name">`
- Rating from `<span class="minirating">` text (strip inner star spans, then parse)
- Cover image from `<img class="bookCover">`

### getBook
Parse `<script id="__NEXT_DATA__">` JSON from HTML. Resolve Apollo `__ref` pointers to dereference:
- `Book:` → title, titleComplete, description, imageUrl, genres, details (pages, format, isbn, language)
- `Work:` → stats (averageRating, ratingsCount, textReviewsCount), awards, publicationTime
- `Contributor:` → author name, legacyId
- `Series:` → series title, user position

### getReviews
Same `__NEXT_DATA__` parse as getBook. Extract all `Review:` and `User:` entries:
- Review text (HTML stripped), rating, likeCount, createdAt (formatted)
- User name resolved from `creator.__ref`
- 30 reviews per page (SSR-rendered, no async loading needed)

### getAuthor
HTML regex parse of Rails author page. Uses both `itemprop` attributes (single quotes in HTML) and class-based selectors:
- Name from `<span itemprop="name">`
- Image from `authorLeftContainer` → first `<img>`
- Bio from `freeText` span inside `aboutAuthorInfo`
- Born/died from `itemprop='birthDate'`/`itemprop='deathDate'`
- Rating from `itemprop='ratingValue'`
- Books from same schema.org/Book rows as search

## Key Learnings

1. **"Heavy bot detection" claims may be outdated or exaggerated.** The original DOC.md stated node transport would fail due to Cloudflare/DataDome/PerimeterX. In reality, none of these systems challenge requests with a standard User-Agent header. Always verify with a probe before assuming browser is required.

2. **`__NEXT_DATA__` is a goldmine for Next.js sites.** The Apollo state cache in SSR provides richer, more structured data than DOM extraction. It includes entities (Book, Work, Contributor, Series, Review, User) with cross-references — essentially a denormalized GraphQL response.

3. **Reviews weren't async-loaded.** The original adapter assumed reviews loaded via GraphQL asynchronously and added `waitForSelector` + 1s delay. In fact, 30 reviews are pre-rendered in the `__NEXT_DATA__` Apollo state. The async loading assumption added unnecessary complexity and latency.

4. **Mixed architecture (Next.js + Rails) is common.** Goodreads has book detail pages on Next.js but search and author pages remain on Rails. Different extraction strategies per page type is expected.

5. **`/book/auto_complete?format=json`** is an undocumented JSON API that works without auth or cookies. Returns 5 results with bookId, title, author, rating, page count, and description. Useful as a fast-path for quick lookups if 5 results suffice.
