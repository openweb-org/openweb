# Hacker News — Transport Upgrade Discovery & Implementation

## Final Architecture

- **Reads (10 ops)**: L1 node-direct — Algolia Search API + Firebase API. Zero browser, zero DOM.
- **Reads (4 ops)**: Adapter with Node.js `fetch` to Algolia — parameterized queries need runtime URL construction.
- **Writes (2 ops)**: Adapter with page context — DOM extraction for auth tokens (vote link href, HMAC).
- **16 operations total** (14 read + 2 write), down from 16 L3 adapter ops to 10 L1 + 6 L3.

## Discovery Journey

### Phase 1: Probe — Understanding HN's Architecture

HN is a famously simple server-rendered site. The probe methodology predicted this would be quick:

**Probe 1: Network capture.**
HN serves pure HTML. No XHR/fetch API calls on page load. No SPA framework, no client-side rendering. Every page is a full HTML document from the server.

**Probe 2: Fetch interceptor.**
`window.fetch` is native (not monkey-patched). No client-side signing, no anti-bot SDK.

**Probe 3: Webpack.**
No webpack. No module bundler at all. HN's JS is minimal — just a few inline scripts for voting, collapsing comments, etc.

**Probe 4: External APIs.**
Two well-documented public APIs serve all HN data:

1. **Firebase API** (`hacker-news.firebaseio.com/v0/`):
   - Feed endpoints: `/v0/topstories.json`, `/v0/newstories.json`, etc. — arrays of item IDs
   - Item detail: `/v0/item/{id}.json` — full item data (title, url, score, by, time, kids, text, type)
   - User profile: `/v0/user/{id}.json` — karma, about, created, submitted
   - No auth required, no rate limiting observed, no bot detection
   - Limitation: feed endpoints return IDs only — need batch-fetch for full data (N+1 problem)

2. **Algolia HN API** (`hn.algolia.com/api/v1/`):
   - Full-text search: `/api/v1/search` (relevance-sorted), `/api/v1/search_by_date` (date-sorted)
   - Tag filters: `front_page`, `story`, `comment`, `ask_hn`, `show_hn`, `job`, `author_XXX`, `story_NNNNN`
   - Item detail with comment tree: `/api/v1/items/{id}` — single request, full nested children
   - Returns rich data in a single request — no N+1 problem
   - No auth, no rate limiting observed

**Decision: node-direct for all reads, page only for writes.**

### Phase 2: Architecture Decision

| Approach | Stability | Speed | Complexity |
|---|---|---|---|
| DOM extraction (before) | Fragile — any selector change breaks | Slow — browser + page load | 16 L3 ops |
| Firebase API | Stable — official API, versioned | Medium — feed ops need N+1 fetches | N/A |
| Algolia API | Stable — dedicated search API | Fast — single request per op | N/A |
| **Hybrid (chosen)** | **Stable** | **Fast** | **10 L1 + 6 L3** |

**Why hybrid?**

- **Algolia for feeds/lists**: Single request returns full data with scores, timestamps, URLs, comment counts. No N+1.
- **Algolia for story detail**: `/api/v1/items/{id}` returns story + full nested comment tree in one request.
- **Firebase for user profile**: Direct mapping — `/v0/user/{id}.json` returns exactly what we need.
- **Algolia for parameterized reads (adapter)**: `getUserSubmissions`, `getUserComments`, `getStoryComments`, `getStoriesByDomain` need computed Algolia tag strings (e.g., `author_pg`, `story_47724352`). L1 spec can't compute query params from user input, so adapter constructs the URL and calls Algolia via Node.js `fetch`.
- **Page for writes**: `upvoteStory` needs the vote link's `href` (contains auth token), `addComment` needs the form's HMAC hidden field. Both require navigating to the item page and extracting from DOM.

### Phase 3: Implementation

**L1 Node ops (10)**:
Each operation uses a virtual path in the spec with `actual_path` pointing to the real Algolia/Firebase endpoint. Query params with defaults provide the tag filters. `unwrap: hits` extracts the hits array from Algolia search responses.

Examples:
- `getTopStories` → `hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30`, unwrap `hits`
- `getStoryDetail` → `hn.algolia.com/api/v1/items/{id}`, no unwrap needed
- `getUserProfile` → `hacker-news.firebaseio.com/v0/user/{id}.json`, operation-level server override

**Adapter ops (6)**:
4 read ops use Node.js `fetch` to Algolia (adapter constructs URL from user params). 2 write ops use `page.evaluate(fetch(...))` for auth token extraction from DOM.

**Response shape changes**:
- Before: `{title, score: "305 points", author, age: "2 hours ago"}` (DOM text)
- After: `{objectID, title, url, author, points: 305, num_comments: 372, created_at: "2026-04-10T...", created_at_i: 1775859400}` (structured API data)

Strictly richer — numeric scores, ISO timestamps, URLs, comment counts, item IDs.

### Phase 4: Considered but Rejected

1. **All Firebase, no Algolia** — feed ops return ID arrays requiring N+1 fetches (30 items x 1 fetch each = 31 total requests). Algolia returns full data in 1 request.

2. **All Algolia, no Firebase** — Algolia items endpoint is great for story detail, but for user profile Firebase is a cleaner single-request mapping. Algolia has no direct user profile endpoint.

3. **All L1 node (no adapter)** — getUserSubmissions/getUserComments need `tags=story,author_pg` where `pg` comes from user input. L1 spec can't compute query params. getStoriesByDomain needs `query` param renamed from `site`. getStoryComments needs `numericFilters=story_id={id}`. All require adapter for URL construction.

4. **node adapter pattern** — Adapters currently require page (browser) context. Creating a "node adapter" would require framework changes beyond scope.

## Key Patterns Discovered

- **HN has two public APIs** with no auth: Firebase (official, item-level) and Algolia (search, full-text, rich).
- **Algolia tags are the filter system**: `front_page`, `story`, `comment`, `ask_hn`, `show_hn`, `job`, `author_XXX`, `story_NNNNN`. Comma = AND, parentheses = OR.
- **`numericFilters=story_id={id}`** filters comments by parent story — useful for getStoryComments.
- **Firebase user.submitted** returns ALL submission IDs (thousands for active users) — Algolia is much more efficient.
- **Algolia `/api/v1/items/{id}`** returns full nested comment tree — single request replaces recursive Firebase fetches.
- **DOM extraction was unnecessary for reads** — both APIs provide all the data HN's HTML pages show.
- **Write ops genuinely need page** — no public API for upvote/comment. Auth tokens (vote link href, form HMAC) are embedded in server-rendered HTML.

## Verification

**Result: 14/14 read ops PASS** (2026-04-11)

10 L1 node ops + 4 adapter read ops, all passing schema validation.
Write ops (upvoteStory, addComment) excluded from automated verify (unsafe_mutation).

## Before/After Summary

| Metric | Before | After |
|---|---|---|
| Transport | All page (browser) | 10 node + 6 page |
| DOM selectors | 15+ CSS selectors | 2 (write ops only) |
| API dependency | None (pure DOM) | Algolia + Firebase |
| Browser required | All 16 ops | 6 ops (4 reads + 2 writes) |
| Response richness | Text strings | Structured data (int scores, ISO timestamps, URLs) |
| L1/L3 split | 0/16 | 10/6 |
| Fragility | High (any UI change) | Low (stable public APIs) |
