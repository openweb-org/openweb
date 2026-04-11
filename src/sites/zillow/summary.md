# Zillow — Transport Upgrade: SSR __NEXT_DATA__ → GraphQL page.evaluate(fetch)

## Final Architecture

- **Reads (3 adapter ops)**: `page.evaluate(fetch('/graphql'))` via persisted query hash — single GraphQL call returns 85+ property fields
- **Search (1 framework op)**: `PUT /async-create-search-page-state` via framework page transport (unchanged)
- **Zero DOM**: no querySelector, no navigation per property, no `__NEXT_DATA__` parsing
- **Zero per-property navigation**: all 3 adapter ops use the same GraphQL call from any zillow.com page
- **4 operations total** (4 read)

## Discovery Journey

### Phase 0: Previous Implementation (SSR __NEXT_DATA__)

The adapter navigated to each property page (`/homedetails/{slug}/{zpid}_zpid/`), waited for the `script#__NEXT_DATA__` element, parsed the JSON, and searched for the property record using a 3-path fallback:
1. `gdpClientCache` (GraphQL data provider cache)
2. `componentProps`, `initialData`, `property`, `listingData` keys
3. Deep recursive search by zpid (depth-limited to 4)

**Problems:**
- **Per-property page navigation**: Each op required a full page load (~30s timeout + 15s wait for `__NEXT_DATA__`)
- **Three fragile search paths**: The `gdpClientCache` key was found to be undefined in testing; the structure varies between property types
- **SSR structure drift**: `__NEXT_DATA__` structure can change with any Next.js deploy — `componentProps` may move to different keys
- **~200KB JSON parsing**: The entire `__NEXT_DATA__` blob is 209KB; only a small fraction is the property data

### Phase 1: Network Probe — Discovery of GraphQL API

Navigated to property detail page with CDP network capture enabled. Captured 365 network requests. Key findings:

**GraphQL endpoint at `/graphql`**: Multiple calls observed during page load:
- `POST /graphql` — initial messaging eligibility check
- `GET /graphql/?extensions={"persistedQuery":...,"sha256Hash":"3b51e213..."}&variables={"zpid":15076238}` — **full property detail** (44KB response, 85 fields)
- `POST /graphql/?operationName=HomeValueChartDataQuery` — Zestimate chart history (3.9KB)
- `GET /graphql/?extensions={"persistedQuery":...,"sha256Hash":"e4018679..."}&variables={"zpid":"15076238"}` — agent ranking data (1.6KB)
- Multiple user-specific queries (saved homes, collections, buyability)

**`/zg-graph` endpoint**: Zillow Group GraphQL (separate from main `/graphql`):
- `POST /zg-graph?operationName=GetUserAccountQuery`
- `POST /zg-graph?operationName=SavedHomes`
- `POST /zg-graph?operationName=GetBuyabilityFinancialProfile`

**`PUT /async-create-search-page-state`**: Confirmed working (200, 200KB response with 41 results)

### Phase 2: Node Fetch Test — Definitively Blocked

Tested all endpoints from Node.js (no browser):
- `PUT /async-create-search-page-state` → 403, `x-px-blocked: 1`
- `GET /homedetails/...` → 403 (CAPTCHA HTML)
- `POST /graphql` → 403 (CAPTCHA HTML)
- `/api/`, `/ajax/`, `/_next/data/`, `/graphql-proxy` → all 403

**PerimeterX blocks ALL Node.js requests.** TLS fingerprint + missing browser context = instant block. Node transport is not possible for any Zillow endpoint.

### Phase 3: Fetch & Webpack Probes

**Fetch probe**: `window.fetch.toString().length` = 189 (lightly patched — native is ~30, TikTok is 3505). The patch is a simple wrapper, not a signing interceptor. No auto-signing like TikTok's `byted_acrawler`.

**Webpack probe**: `webpackChunk_N_E` with 260 modules (standard Next.js webpack). Not investigated further since GraphQL API was already discovered and sufficient.

**Window globals of interest:**
- `__NEXT_DATA__` — still exists (209KB), structure: `{props.pageProps.componentProps}` (no `gdpClientCache`)
- `__Z_USER_SESSION_STORE__` — Redux store with dispatch/subscribe/getState
- `__PFS_TOPNAV_DATA__` — page frame server data
- `ZillowAnalyticsObject` = `zanalytics`

### Phase 4: GraphQL page.evaluate(fetch) — CSRF Discovery & Resolution

First attempt at `page.evaluate(fetch('/graphql/...'))` failed with CSRF error:
```
This operation has been blocked as a potential Cross-Site Request Forgery (CSRF).
Please either specify a 'content-type' header (with a mime-type that is not one of
application/x-www-form-urlencoded, multipart/form-data, text/plain) or provide one
of the following headers: x-caller-id, client-id, x-caller-version,
x-apollo-operation-name, x-apollo-operation-id, apollo-require-preflight
```

**Fix**: Added `x-caller-id: openweb` header. GraphQL now returns 200 with full property data.

**Cross-property queries work**: Tested fetching zpid 15076238 from a different zillow.com page — works. No need to be on the specific property page.

### Phase 5: Data Mapping

The persisted query (hash `3b51e213...`) returns 85 property fields. Mapped all fields to adapter response schemas:

| Adapter Field | GraphQL Source | Notes |
|---------------|---------------|-------|
| zpid | `property.zpid` | Direct |
| address.* | `property.address.*` | Direct |
| price | `property.price` | Direct |
| bedrooms | `property.bedrooms` ∪ `resoFacts.bedrooms` | Top-level may be null for some property types |
| bathrooms | `property.bathrooms` ∪ `resoFacts.bathrooms` | Same as above |
| livingArea | `property.livingAreaValue` ∪ `resoFacts.livingArea` | Numeric value |
| yearBuilt | `resoFacts.yearBuilt` | Only in resoFacts |
| description | `property.description` | Direct |
| zestimate | `property.zestimate` | Direct |
| rentZestimate | `property.rentZestimate` | Direct |
| taxAssessedValue | `taxHistory[0].value` | Most recent assessment |
| taxAssessedYear | `taxHistory[0].time` → year | Converted from epoch |
| daysOnZillow | `property.daysOnZillow` | Direct |
| schools | `property.schools[]` | With name, rating, grades, distance, link |
| nearbyHomes | `property.nearbyHomes[]` | With zpid, address, price, beds, baths, area, type |
| photos | `responsivePhotos` ∪ `compsCarouselPropertyPhotos` ∪ `thumb` | Fallback chain |
| url | `property.hdpUrl` | Prefixed with domain |

**Fields NOT available from GraphQL (returned as null):**
- `pageViewCount`, `favoriteCount` — not in any GraphQL query
- `zestimateLowPercent`, `zestimateHighPercent` — not in this persisted query
- `walkScore`, `transitScore`, `bikeScore` — not in GraphQL response (were in `__NEXT_DATA__` property object but also unreliable there)
- `zestimateHistory` — available from separate `HomeValueChartDataQuery` but not implemented (would need query body/hash; data points are timestamp/value pairs)

All fields that return null are marked `type: [*, "null"]` in the schema — no schema violations.

### Phase 6: Architecture Decision

**Considered but rejected:**

1. **Intercept approach** (navigate → capture GraphQL responses): Would capture the same data but still requires per-property page navigation. Slower, no advantage over `page.evaluate(fetch)`.

2. **Webpack module walk** (Telegram model): Only 260 Next.js modules — no heavy service classes like Telegram's GramJS/callApi. The GraphQL persisted query is the API; there's nothing deeper to find.

3. **HomeValueChartDataQuery for Zestimate history**: Would provide `{x: timestamp, y: value}` data points. Rejected for now: requires either intercepting the request body or guessing the query/hash. The chart data is a secondary enrichment, not core property data.

**Decision: `page.evaluate(fetch('/graphql'))` via persisted query hash.**
- Single fetch per property, no page navigation
- 85+ fields from one call
- Only requires being on any zillow.com page (for same-origin + cookies)
- CSRF resolved by `x-caller-id` header
- Uses framework's `pageFetch` helper (timeout + error handling)

## Key Patterns Discovered

- **Zillow's GraphQL uses persisted queries**: `GET /graphql/?extensions={"persistedQuery":{"version":1,"sha256Hash":"..."}}&variables={...}`. The hash identifies the query without sending the full query string.
- **CSRF protection via header check**: Apollo Server CSRF prevention requires a non-simple Content-Type or specific headers. `x-caller-id` satisfies this.
- **PerimeterX blocks ALL Node.js**: Not just headless browsers — even Node `fetch` with Chrome UA is blocked via TLS fingerprinting (`x-px-blocked: 1`).
- **Zillow has dual GraphQL endpoints**: `/graphql` (property/listing data) and `/zg-graph` (user/account data). Both require browser context.
- **`__NEXT_DATA__` structure varies**: This property had `componentProps` but no `gdpClientCache`. The adapter's 3-path fallback was fragile by necessity.
- **Property data varies by listing status**: "Not for sale" properties may have null bedrooms/bathrooms at top level (available in `resoFacts`). Active listings likely have them.
- **Cross-property GraphQL works**: Can query any zpid from any zillow.com page — no need to navigate to the specific property URL.

## Probe Evidence

### GraphQL persisted query (hash 3b51e213...)

```
GET /graphql/?extensions={"persistedQuery":{"version":1,"sha256Hash":"3b51e213e2bc8dbf539cdb31f809991a62e1f5ce3cc0d011a8391839e024fa4e"}}&variables={"zpid":15076238,"altId":null,"deviceTypeV2":"WEB_DESKTOP"}
Headers: x-caller-id: openweb
→ 200, 44KB response, 85 property fields
```

### Node fetch results

| Endpoint | Status | Blocked By |
|----------|--------|------------|
| PUT /async-create-search-page-state | 403 | PerimeterX (`x-px-blocked: 1`) |
| GET /homedetails/.../_zpid/ | 403 | PerimeterX CAPTCHA HTML |
| POST /graphql | 403 | PerimeterX CAPTCHA HTML |
| GET /api/ | 403 | PerimeterX |
| GET /_next/data/ | 403 | PerimeterX |

### CSRF error message

```
This operation has been blocked as a potential Cross-Site Request Forgery (CSRF).
Please provide one of: x-caller-id, client-id, x-caller-version,
x-apollo-operation-name, x-apollo-operation-id, apollo-require-preflight
```

## Pitfalls

- **PerimeterX CAPTCHA is aggressive**: Even headed Chrome gets CAPTCHA on first visit. Needs human solve or warm session from prior browsing. Sessions degrade after ~10 minutes of inactivity.
- **Persisted query hash is deployment-specific**: The hash `3b51e213...` works as of 2026-04-11. Zillow deploys may change it. If it returns a "PersistedQueryNotFound" error, capture the new hash from browser DevTools.
- **`pageViewCount`/`favoriteCount` not available**: These counters are not in any observed GraphQL query. May be rendered server-side only.
- **Walk/transit/bike scores not in GraphQL**: These were in `__NEXT_DATA__` but are not in the persisted query response. Would need a separate API or the SSR data.
- **searchProperties is separate from the adapter**: Uses the framework's page transport for `PUT /async-create-search-page-state`. Not upgraded (already works).

## Verification

**Result: 4/4 PASS** (2026-04-11)

4 read ops, all passing via `verify zillow --browser`.
