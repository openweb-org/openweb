# Airbnb — Transport Upgrade Discovery & Implementation

## Final Architecture

- **Search + Listing detail**: Node.js HTML fetch + SSR parsing (`#data-deferred-state-0`)
- **Reviews**: Direct GraphQL API call (`StaysPdpReviewsQuery`) — zero browser
- **Availability**: Direct GraphQL API call (`PdpAvailabilityCalendar`) — zero browser
- **Host profile**: Browser page navigation + SSR extraction (bot detection blocks node)
- **5 operations total** (all adapter-based, 4/5 need zero page navigation)

## Discovery Journey

### Phase 1: Network Capture

Ran CDP network capture on headed browser across 3 page types (search, listing detail, host profile). Discovered Airbnb uses **persisted GraphQL queries** at `/api/v3/{OperationName}/{sha256Hash}`.

**Search page** (`/s/Tokyo/homes`):
- No dedicated search API call — search results are embedded in SSR HTML
- Map-related APIs: `PlaceListingPolygonQuery`, `MapViewportInfoQuery`, `PlacesMapTileLayersQuery`
- Utility APIs: `Header`, `AutoSuggestionsQuery`, `GetConsentForUserQuery`

**Listing detail** (`/rooms/20713816`):
- `StaysPdpSections` (POST) — secondary booking sections, fired after initial load
- `PdpAvailabilityCalendar` (GET) — 12 months of calendar data
- `StaysPdpReviewsQuery` (GET) — 24 reviews per request, fired on scroll
- Initial listing data (33 sections) embedded in SSR, not fetched via API

**Host profile** (`/users/show/70270073`):
- No profile-specific API call — data is SSR-embedded
- Different SSR structure than listing/search pages

### Phase 2: Fetch & Webpack Analysis

- **`window.fetch` is monkey-patched** — 2681 chars (tracking/analytics interceptor, not signing)
- **No webpack modules found** — Airbnb doesn't use standard webpack chunk patterns (`webpackChunk`, `__LOADABLE_LOADED_CHUNKS__`, `webpackJsonp` all absent)
- **API key found**: `d306zoyjsyarp7ifhu67rjxn52tv0t20` — sent as `X-Airbnb-API-Key` header on all GraphQL requests
- **Platform headers required**: `X-Airbnb-GraphQL-Platform-Client: minimalist-niobe` + `X-Airbnb-GraphQL-Platform: web` — without these, GraphQL queries return `ValidationError`

### Phase 3: Direct API Testing

Tested all endpoints from both `page.evaluate(fetch)` and Node.js `fetch()`:

| Endpoint | page.evaluate | Node.js | Notes |
|----------|--------------|---------|-------|
| `PdpAvailabilityCalendar` | PASS | PASS | GET, no cookies needed |
| `StaysPdpReviewsQuery` | PASS | PASS (with platform headers) | GET, needs platform headers |
| `StaysPdpSections` | PASS (replay) | PASS (specific sectionIds only) | POST, `sectionIds: null` returns ValidationError |
| Search HTML | N/A | PASS | 18 results from SSR |
| Listing HTML | N/A | PASS | 33 sections from SSR |
| Host profile HTML | N/A | BOT DETECTION | "Press & Hold" challenge, no `#data-deferred-state-0` |

**Key finding**: The `StaysPdpSections` API can only fetch specific section subsets (booking sections) — it cannot replace the SSR for the full 33-section listing detail. The initial listing data is server-rendered only.

### Phase 4: Architecture Decision

```
Stability ladder for Airbnb:

  script_json (SSR)        ← was here (search, detail)
    ↓
  GraphQL intercept        ← was here (reviews, calendar)
    ↓
  node API call            ← reviews, calendar now here
  node HTML fetch + parse  ← search, detail now here
```

**Decision: Node fetch for 4/5 ops, browser for host profile only.**

Rationale:
- Reviews and calendar are pure API calls — `fetch()` with API key and platform headers, no cookies, no signing
- Search and listing detail HTML is served by Airbnb without bot detection — SSR data parseable from raw HTML
- Host profile page triggers bot detection from Node.js — must use browser with rendered page

**Rejected approaches:**
1. **StaysPdpSections API for full listing detail** — API returns ValidationError with `sectionIds: null`. Only works for specific booking section subsets, not the full 33-section detail view.
2. **Full node transport** (no browser at all) — blocked by host profile bot detection
3. **Webpack module walk** — no webpack modules found; Airbnb uses a custom module system

### Phase 5: Implementation

**New adapter** (`airbnb.ts`): single adapter handles all 5 ops with mixed transport:
- `searchListings`: `fetch()` HTML → regex parse `#data-deferred-state-0` → JSON → `niobeClientData[].data.presentation.staysSearch.results`
- `getListingDetail`: `fetch()` HTML → same SSR parse → `stayProductDetailPage`
- `getListingReviews`: `fetch()` GraphQL API directly → 24 reviews with metadata
- `getListingAvailability`: `fetch()` GraphQL API directly → 12 months of calendar
- `getHostProfile`: `page.goto()` → browser SSR extraction (multi-strategy fallback)

**Changes from previous implementation:**
- Eliminated page navigation for 4/5 ops (was: navigate + wait + scroll + intercept)
- Eliminated GraphQL response interception (was: `page.on('response')` with 25s timeout polling)
- Eliminated scroll-to-trigger-GraphQL pattern (was: scroll page to trigger lazy load of reviews)
- Eliminated script_json runtime extraction (was: runtime handled extraction via spec config)
- All ops now go through adapter (unified, consistent)

**Old adapter deleted**: `airbnb-web.ts` / `airbnb-web.js` removed.

## Key Patterns Discovered

- **Persisted GraphQL queries**: Airbnb uses APQ (Automatic Persisted Queries) at `/api/v3/{OperationName}/{sha256Hash}` with variables in URL (GET) or body (POST)
- **API key is public**: `d306zoyjsyarp7ifhu67rjxn52tv0t20` — same for all users, no session needed
- **Platform headers mandatory**: `X-Airbnb-GraphQL-Platform-Client: minimalist-niobe` and `X-Airbnb-GraphQL-Platform: web` — without them, queries fail with ValidationError
- **Listing ID encoding**: Reviews API needs base64-encoded ID format `StayListing:{numericId}` → `U3RheUxpc3Rpbmc6MjA3MTM4MTY=`
- **SSR via deferred state**: Airbnb embeds SSR data in `<script id="data-deferred-state-0">` containing `niobeClientData` array with presentation data
- **No webpack**: Custom module system — no `webpackChunk`, no `__LOADABLE_LOADED_CHUNKS__`
- **Patched fetch is tracking only**: Unlike TikTok, Airbnb's fetch interceptor adds analytics, not cryptographic signatures — direct API calls work without it
- **Host profile is different**: Uses different SSR structure, triggers bot detection from Node.js, no profile-specific API endpoint

## Pitfalls

- Reviews API requires both `X-Airbnb-API-Key` AND platform headers — API key alone returns ValidationError
- `StaysPdpSections` API cannot fetch all sections — only responds to specific `sectionIds` list, not `null`
- Host profile page doesn't have `#data-deferred-state-0` — uses application/json script tags with layout/config data
- GraphQL hashes are deployment-specific — if Airbnb changes their query hashes, the API calls will fail with `PersistedQueryNotFound`
- SSR data path `niobeClientData.0.1.data.presentation` depends on array structure — could change

## Verification

**Result: 5/5 PASS** (2026-04-11)

```
✓ airbnb: PASS (5/5 ops)
  ✓ getHostProfile: PASS
  ✓ getListingAvailability: PASS
  ✓ getListingDetail: PASS
  ✓ getListingReviews: PASS
  ✓ searchListings: PASS
```
