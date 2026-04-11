# IMDb — Transport Upgrade: SSR Extraction to GraphQL API

## Final Architecture

- **Reads (3 ops)**: Direct GraphQL API calls to `api.graphql.imdb.com` via Node.js `fetch()` — zero page dependency
- **Ratings (1 op)**: GraphQL for aggregate + vote count, `__NEXT_DATA__` SSR fallback for histogram only
- **Zero DOM**: no `querySelector`, no `click`, no navigation for data (only ratings histogram uses `page.goto` + SSR parse)
- **4 operations** (all read): searchTitles, getTitleDetail, getRatings, getCast

## Discovery Journey

### Phase 1: Node GraphQL Probe

The upgrade task doc noted "IMDb has GraphQL" — first step was testing if it works from Node.js without auth or bot detection.

**Probe 1: Raw GraphQL from Node.js.**

```
POST https://api.graphql.imdb.com/
Body: {"query": "query { title(id: \"tt0111161\") { titleText { text } } }"}
→ 200 OK: {"data":{"title":{"titleText":{"text":"The Shawshank Redemption"}}}}
```

**No auth, no signing, no CSRF, no bot detection.** The GraphQL API at `api.graphql.imdb.com` is completely open for read operations from Node.js. This was the best possible outcome — no browser needed.

**Probe 2: Schema introspection.**

Introspection query returns `FORBIDDEN: Unauthorized introspection request. Token is invalid or missing`. However, the API provides helpful `Did you mean` suggestions on invalid field names, enabling incremental discovery.

**Probe 3: Query discovery via error probing.**

Tried common query patterns:
- `title(id: "tt0111161") { ... }` → **SUCCESS** — full title data
- `mainSearch(first: 20, options: { searchTerm: "inception", type: TITLE }) { edges { node { entity { ... on Title { ... } } } } }` → **SUCCESS** — search results with full metadata
- `searchTitles(...)` → error, suggested `chartTitles` or `mainSearch`
- `titleSearch(...)` → error, suggested `mainSearch`

Key fields confirmed working:
- `titleText`, `originalTitleText`, `titleType`, `releaseYear`, `ratingsSummary`, `runtime`, `certificate`, `genres`, `plot`, `primaryImage`, `releaseDate`, `keywords`, `principalCredits`, `reviews`, `nominations`, `prestigiousAwardSummary`, `metacritic`, `meterRanking`

### Phase 2: Histogram Probe — the One Gap

The `getRatings` operation returns a per-rating vote histogram (1-10 breakdown). Exhaustive probing of the GraphQL schema found **no histogram field**:

- `ratingsSummary` only has `aggregateRating` and `voteCount`
- Tried `ratingsDistribution`, `ratingHistogram`, `voteDistribution`, `ratingsDetail`, `ratingBreakdown`, `demographicData` — all nonexistent
- `engagementStatistics` exists but only has `watchlistStatistics`

The histogram comes from `__NEXT_DATA__` → `pageProps.contentData.histogramData.histogramValues` on the server-rendered ratings page. This data is assembled server-side via internal (non-public) GraphQL persisted queries.

**Node fetch of the ratings page returns 202 (Cloudflare block)** — can't parse HTML from Node.

### Phase 3: CDP Network Capture

Captured browser traffic on the ratings page:
- 3 client-side GraphQL calls: WebAds, PrivacyPrompt, RVI_TitleView (tracking mutation)
- None contain histogram data — it's purely in SSR `__NEXT_DATA__`
- `caching.graphql.imdb.com` endpoint exists but requires persisted query hashes (internal only)

### Phase 4: Architecture Decision

**Considered but rejected:**

1. **Pure node transport (no adapter)**: Framework's node executor builds URLs from spec + makes HTTP calls. Can't construct per-operation GraphQL queries from OpenAPI spec alone. Would need 4 separate paths all pointing to `/` with different request bodies — awkward and fragile.

2. **Drop histogram from getRatings**: Breaking change. The histogram is the primary value of the ratings op. Without it, `getRatings` is just `getTitleDetail.ratingsSummary` with less data.

3. **All ops via SSR + `__NEXT_DATA__` (status quo)**: Works but fragile. Next.js RSC migration would break everything. `__NEXT_DATA__` structure changes on deploy. 700KB JSON payloads.

**Decision: Adapter with hybrid transport.**

- 3/4 ops use `fetch()` to call GraphQL directly — zero DOM, zero page, pure API
- 1/4 ops (getRatings) uses GraphQL for aggregate data + page navigation for histogram only
- The adapter still receives a `page` parameter (framework requirement), but 3 ops don't use it at all

**Stability gain:**
```
Before:  All 4 ops → __NEXT_DATA__ SSR extraction (fragile)
After:   3 ops → GraphQL API (stable), 1 op → GraphQL + SSR histogram (partial fragility)
```

On the stability ladder:
```
SSR global variable  →  API call (node fetch)
     ↑ was here            ↑ now here (3/4 ops)
```

### Phase 5: Implementation

Rewrote `adapters/imdb.ts`:
- **GraphQL helper**: `gql<T>(query, variables)` — typed wrapper over `fetch()` to `api.graphql.imdb.com`
- **Shared fragments**: `TITLE_CORE_FIELDS` and `TITLE_DETAIL_FIELDS` for DRY query construction
- **searchTitles**: `mainSearch` query with `type: TITLE` filter, 20 results
- **getTitleDetail**: `title(id)` query with full fields including credits, keywords, reviews, awards
- **getCast**: `title(id)` query with `principalCredits`, extracts actors/directors/creators by category name matching
- **getRatings**: `title(id)` for aggregate + `page.goto()` for histogram from `__NEXT_DATA__`

Code: 213 lines → 220 lines (similar size, but zero `navigateAndExtract`, zero DOM parsing for 3/4 ops).

### Phase 6: Verification

**Result: 4/4 PASS** via `verify imdb --browser`

- `searchTitles`: 20 results with full metadata (was ~25 via SSR, now 20 via GraphQL `first: 20`)
- `getTitleDetail`: All fields present including runtime, certificate, keywords, credits
- `getRatings`: Aggregate + full 10-value histogram
- `getCast`: Credits, actors, directors, creators all populated

## Key Patterns Discovered

- **IMDb GraphQL API is fully open**: `api.graphql.imdb.com` requires no auth, no signing, no cookies for read operations. Direct Node.js `fetch()` works.
- **No introspection, but helpful errors**: `Did you mean "X"?` suggestions on invalid fields enable incremental schema discovery.
- **Histogram not in public GraphQL**: The per-rating vote breakdown (1-10) is only available via server-rendered `__NEXT_DATA__` on the `/ratings/` page. Internal persisted queries assemble this data.
- **Cloudflare blocks Node HTML fetch**: `www.imdb.com` returns HTTP 202 (empty body) for Node.js HTML requests. Only the GraphQL API endpoint is unrestricted.
- **Framework adapter always needs browser**: Even if the adapter uses only `fetch()`, the `executeAdapter` path spins up a browser. Pure node transport would require no adapter (direct HTTP execution), but that can't handle per-operation GraphQL query construction.
- **`principalCredits` has category-based structure**: Director/Writer/Stars categories are identified by `category.text`, not separate fields. Pattern matching ("star", "actor", "director", "writer") extracts them.
- **`prestigiousAwardSummary` vs `nominations`**: Top-level `nominations(first: 0).total` gives all nominations. `prestigiousAwardSummary.wins` gives major award wins only (Oscars etc.), while total wins isn't directly available.

## Probe Evidence

### GraphQL API — no auth required

```
curl -X POST https://api.graphql.imdb.com/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"query{title(id:\"tt0111161\"){titleText{text}ratingsSummary{aggregateRating}}}"}'

→ {"data":{"title":{"titleText":{"text":"The Shawshank Redemption"},"ratingsSummary":{"aggregateRating":9.3}}}}
```

### Available query roots

| Query | Args | Works from Node |
|-------|------|-----------------|
| `title(id: ID!)` | title ID (tt...) | Yes |
| `mainSearch(first: Int!, options: { searchTerm, type })` | search term + TITLE filter | Yes |
| `chartTitles(chart: ChartTitleOptions!)` | chart type (not explored) | Likely |

### Title type fields confirmed (partial list)

`id`, `titleText`, `originalTitleText`, `titleType`, `releaseYear`, `ratingsSummary`, `runtime`, `certificate`, `genres`, `plot`, `primaryImage`, `releaseDate`, `keywords(first)`, `principalCredits`, `reviews(first)`, `nominations(first)`, `prestigiousAwardSummary`, `metacritic`, `meterRanking`, `canRate`, `isAdult`, `engagementStatistics`, `canHaveEpisodes`, `series`, `episodes`, `moreLikeThisTitles`, `akas`, `countriesOfOrigin`, `productionBudget`, `openingWeekendGross`, `lifetimeGross`, `technicalSpecifications`, `filmingLocations`, `productionStatus`, `externalLinks`

### Fields NOT on public GraphQL

- Per-rating vote histogram (only in `__NEXT_DATA__` SSR)
- Detailed demographic breakdown (age/gender ratings)
- Full cast beyond principalCredits (LD+JSON had more actors, but GraphQL's `principalCredits` covers top 10 per category)

## Pitfalls

- GraphQL introspection is blocked — you must probe field names incrementally
- `mainSearch` returns mixed entity types — filter with `... on Title { }` inline fragment
- `reviews` and `nominations` require `first: Int!` argument (even `first: 0` for just the `total` count)
- `wins` is not a top-level field on Title — use `prestigiousAwardSummary.wins` (major awards only)
- Ratings histogram is the one remaining SSR dependency — if IMDb removes `__NEXT_DATA__`, only the histogram breaks (aggregate rating still from GraphQL)
- Node HTML fetch returns 202 (Cloudflare) — can't scrape pages from Node, only use the GraphQL API
