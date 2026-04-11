# Douban — Transport Upgrade: Page → Node

## Final Architecture

- **All 14 operations**: node transport (direct HTTP to `m.douban.com/rexxar/api/v2/*`)
- **Zero browser dependency**: only requires `Referer: https://m.douban.com/` header
- **Zero DOM**: adapter `douban-dom.ts` fully retired
- **14 operations total** (14 read, 0 write)

## Discovery Journey

### Phase 1: Probe — Mobile API from Node

The DOC.md claimed "Page transport required for all operations. Both the mobile API and desktop sites validate request origin — node transport returns 400/403."

Tested this claim directly:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Referer: https://m.douban.com/" \
  "https://m.douban.com/rexxar/api/v2/movie/1292052"
# → 200
```

**All 10 existing mobile API endpoints returned 200 from node.** The only required header is `Referer: https://m.douban.com/`. Without Referer → 400. User-Agent is optional. Origin is optional.

**Lesson**: Don't trust doc claims about transport restrictions. Always probe.

### Phase 2: Probe — API Alternatives for Adapter Ops

The site had 4 operations using the `douban-dom.ts` adapter for DOM extraction:
- `getMoviePhotos` — scraped `movie.douban.com/subject/{id}/photos` HTML
- `getTop250` — scraped `movie.douban.com/top250` HTML
- `searchMusic` — scraped `search.douban.com/music/subject_search` HTML
- `getMusicDetail` — scraped `music.douban.com/subject/{id}/` HTML

The DOC.md stated "Mobile API has no music endpoints — music only via desktop adapter."

Probed for mobile API equivalents:

| Adapter op | API probe | Result |
|-----------|-----------|--------|
| getMoviePhotos | `/rexxar/api/v2/movie/{id}/photos` | **200** — returns JSON with image URLs, dimensions, metadata |
| getTop250 | `/rexxar/api/v2/subject_collection/movie_top250/items` | **200** — returns ranked items with `rank_value` field |
| searchMusic | `/rexxar/api/v2/search/music` | **200** — same pattern as movie/book search |
| getMusicDetail | `/rexxar/api/v2/music/{id}` | **200** — rich JSON with singer[], songs[], genres[], etc. |

**All 4 adapter ops had mobile API equivalents.** The API data is richer than DOM extraction:
- Photos API returns image dimensions, creation dates, like/comment counts
- Top250 API returns `rank_value` field, covers, descriptions
- Music detail API returns structured `singer[]`, `songs[]` with titles, `genres[]`, `publisher[]`

### Phase 3: Architecture Decision

```
Prior: page transport → 10 ops via page-fetch, 4 ops via DOM adapter
After: node transport → 14 ops via direct HTTP
```

**Decision: full migration to node transport.** Rationale:
1. All 14 endpoints work from node with just a Referer header — no cookies, no signing, no auth needed
2. The mobile API (`m.douban.com/rexxar/api/v2/*`) is a unified, consistent RESTful JSON API
3. The API returns structured JSON — no DOM parsing, no selector fragility
4. Node transport is the fastest option (no browser startup, no page navigation)

**Rejected alternatives:**
- Keeping page transport for adapter ops — unnecessary, API works from node
- Mixed transport (node for API ops, page for adapter ops) — unnecessary complexity

### Phase 4: Implementation

Changes:
1. `openapi.yaml`: `transport: page` → `transport: node`
2. Added `Referer` as a shared component parameter (`$ref: '#/components/parameters/Referer'`) with default `https://m.douban.com/`
3. Replaced 4 adapter op paths with API endpoints:
   - `/movie/{id}/photos` → `/rexxar/api/v2/movie/{id}/photos`
   - `/top250` → `/rexxar/api/v2/subject_collection/movie_top250/items`
   - `/search/music` → `/rexxar/api/v2/search/music`
   - `/music/{id}` → `/rexxar/api/v2/music/{id}`
4. Updated response schemas to match actual API response shapes
5. Removed all `adapter:` references from the spec
6. `manifest.json`: `l1_count: 10, l3_count: 4` → `l1_count: 14, l3_count: 0`
7. Added example files for 4 new API ops

**Adapter `douban-dom.ts` is now unused** — all 14 ops go through the API.

## Key Patterns Discovered

- **Douban's Rexxar API is open**: The mobile API (`m.douban.com/rexxar/api/v2/*`) only validates Referer header. No cookies, no tokens, no signing needed for public data.
- **Referer is the only gate**: `Referer: https://m.douban.com/` is required (returns 400 without it). Origin and User-Agent are optional.
- **Music endpoints exist**: Despite no public documentation, the mobile API has `/search/music`, `/music/{id}` with rich JSON responses.
- **Collection API for curated lists**: `/subject_collection/{collection_id}/items` pattern works for Top 250 and potentially other curated lists.
- **Photo API has rich metadata**: Returns image dimensions, creation dates, author info, engagement counts — far more than DOM scraping provided.
- **Response shapes are consistent**: Search endpoints (movie, book, music) all use the same `{count, start, total, items: [{target_id, target, target_type}]}` pattern.

## Pitfalls

- Rate limiting: Douban is known for aggressive rate limits. Node transport makes it easier to hit limits since there's no browser-imposed latency between requests.
- The `searchMusic` parameter is `q` (matching movie/book search), not `query` (as the old adapter used).
- Top250 uses collection pattern (`subject_collection_items`) not a dedicated endpoint.
- Music detail `songs[]` contains objects with `title` field, not plain strings (adapter returned plain strings).

## Verification

**Result: 14/14 PASS** (2026-04-11)

All 14 operations passing via node transport. Zero browser dependency.
