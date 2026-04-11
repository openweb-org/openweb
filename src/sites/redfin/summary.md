# Redfin — Transport Upgrade Summary

## Final Architecture

- **searchHomes**: `pageFetch` → Stingray GIS API (`/stingray/api/gis`) — structured JSON, no DOM
- **getPropertyDetails**: `pageFetch` → property page HTML → JSON-LD string parsing — no DOM rendering
- **getMarketData**: `pageFetch` → market page HTML → regex text extraction — no DOM rendering
- **Zero DOM operations**: no querySelector, no click, no evaluate for DOM access
- **3 operations total** (3 read)

## Discovery Journey

### Phase 1: Network Probe

Navigated to Redfin search, property, and market pages with CDP request capture. Discovered the Stingray API — Redfin's internal API layer:

**Active Stingray endpoints found on search page:**
- `/stingray/corvair/v2/resolveBouncerFlags?flags=...` (feature flags, multiple calls)
- `/stingray/do/get-feed-badge` (notification badge)
- `/stingray/api/builder-boost/dma-region/zip/...` (builder promotions)
- `/stingray/user/segments` (user segmentation)
- `/stingray/api/builder-boost/6/{regionId}/county` (county data)
- `/corv/api/cop/placement/...` (ad placements)

**Key insight**: Search results and property details are SSR-baked into the initial HTML — no XHR/fetch calls load the main content. But the Stingray API exists for programmatic access.

### Phase 2: Stingray API Probing

Probed known and guessed Stingray endpoints from the browser context:

| Endpoint | Status | Data |
|----------|--------|------|
| `/stingray/api/gis?region_id=...` | **200** ✓ | Full search results: 20 homes with MLS ID, price, beds, baths, sqft, lot size, year built, lat/long, photos, open house info, days on market |
| `/stingray/api/gis-csv?...` | **200** ✓ | Same data in CSV format |
| `/stingray/api/home/details/avm?propertyId=...` | **200** ✓ | Property valuation: beds, baths, sqft, price, address, comparables |
| `/stingray/api/home/details/descriptiveParagraph?propertyId=...` | **200** ✓ | Feature text, built year, full address text |
| `/stingray/api/home/details/belowTheFold` | **403** ✗ | CloudFront WAF blocked |
| `/stingray/api/home/details/aboveTheFold` | **403** ✗ | CloudFront WAF blocked |
| `/stingray/api/home/details/mainHouseInfoPanelInfo` | **403** ✗ | CloudFront WAF blocked |
| `/stingray/api/home/details/initialInfo` | **403** ✗ | CloudFront WAF blocked |

**GIS API response format**: `{}&&{JSON}` — JSONP protection prefix that must be stripped before parsing.

**GIS API is dramatically richer than JSON-LD**: includes MLS ID, days on market, open house times, lot size, year built, stories, listing agent, sashes/badges, price per sqft — none of which were available from the old JSON-LD scraping.

### Phase 3: Fetch & Webpack Probes

- **`window.fetch` patched**: 211 chars (DataDog RUM monitoring wrapper, not signing)
- **Webpack**: `webpackJsonp` with 13 chunks, 78 modules — small bundle, mainly ads/Raven analytics. No useful service classes or API client modules.
- **Framework**: React Server Components with `__reactServerState`, `__reactServerClientController`. Not a heavy SPA — mostly SSR.

### Phase 4: Node Direct Viability

Tested all working APIs and page fetches from Node.js (no browser):

| Request | Node Status | Data |
|---------|-------------|------|
| GIS API | **200** ✓ | Full search results — identical to browser |
| AVM API | **200** ✓ | Property valuation — identical |
| descriptiveParagraph API | **200** ✓ | Feature text — identical |
| Property page HTML | **200** ✓ | 983KB, contains 3 JSON-LD blocks |
| Market page HTML | **200** ✓ | 837KB, contains market stats text |

**All data is accessible from Node.js without browser cookies or signing.** No bot detection on API or page requests.

### Phase 5: Architecture Decision

**Considered approaches:**

1. **Node direct (no adapter)** — Best performance but framework limitation: `parseResponseBody` can't handle `{}&&` JSONP prefix; response transformation for GIS data is too complex for `x-openweb.unwrap` alone.

2. **Node fetch inside adapter** — Adapter uses `globalThis.fetch()`. Works but adapter executor still starts a browser page (wasted resource).

3. **`pageFetch` inside adapter** ← **CHOSEN** — Adapter calls APIs via `page.evaluate(fetch(...))`. Browser context handles cookies automatically. Follows framework patterns (same as TikTok approach). Zero DOM operations — only HTTP requests through the page context.

**Decision**: `pageFetch` for all 3 ops. This moves from DOM parsing (fragile) to API + HTML string parsing (stable). The stability ladder position moves from "DOM解析提取" to "page.evaluate(fetch)" — two levels up.

## Implementation

### searchHomes — Stingray GIS API

Complete rewrite from JSON-LD scraping to API call:
- Calls `/stingray/api/gis` with region/market params
- Strips `{}&&` JSONP prefix, parses JSON
- Maps GIS response fields to output schema (property type enum → string, nested value objects → flat fields)

**Data quality improvement**: 20 homes vs ~6 from JSON-LD. Fields now include: MLS ID, days on market, open house info, lot size, year built, stories, price per sqft.

### getPropertyDetails — HTML Fetch + JSON-LD

Same data source (JSON-LD) but different extraction:
- `pageFetch` GET to property URL → returns full HTML as text
- Regex extracts `<script type="application/ld+json">` blocks
- Parses JSON, finds `RealEstateListing` typed block
- Same field mapping as before

**Why not AVM API?** AVM lacks description, images, amenities, datePosted, propertyType. JSON-LD has everything. But now extracted from fetched HTML string instead of browser DOM.

### getMarketData — HTML Fetch + Regex

Same extraction approach but without browser rendering:
- `pageFetch` GET to market page URL → returns full HTML
- Strips `<script>`/`<style>` tags, then all HTML tags → plain text
- Same regex patterns for median price, homes sold, days on market, YoY, sale-to-list, competitiveness
- Location from `<h1>` tag via regex

**Bug fix**: Improved regex to capture "$850K" format (was "$850" before — the "K" suffix was being dropped by `[\d,]+` pattern).

## Key Patterns Discovered

- **Stingray API** is Redfin's internal API layer — `{}&&{JSON}` JSONP-protected responses
- **GIS endpoint** returns rich search results without authentication or signing
- **Most property detail APIs are WAF-blocked** (CloudFront 403) — only `avm` and `descriptiveParagraph` are accessible
- **No market data API exists** — housing market stats are only in SSR HTML
- **All Redfin data is accessible from Node.js** — no bot detection, no signing, no auth cookies needed
- **React Server Components** architecture — not a traditional SPA, no useful webpack modules
- **Price formatting**: Market page uses "$850K" not "$850,000" — regex must capture the "K" suffix

## Pitfalls

- The GIS API `{}&&` prefix makes it incompatible with standard JSON parsing — always strip first
- Property detail endpoints (`belowTheFold`, `aboveTheFold`) return CloudFront 403 — don't use
- Market page has no structured API — regex text extraction is the only option
- HTML tag stripping for text extraction can break prices if tags split digits (e.g., `$<span>850</span>,000`)
- The `market` param for GIS API should be lowercase city name (e.g., "seattle" not "Seattle")

## Verification

**Result: 3/3 PASS** (2026-04-11)

3 read ops, all passing with schema validation.
