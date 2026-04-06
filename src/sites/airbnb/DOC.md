# Airbnb

## Overview
Travel marketplace — accommodation search and listing details via browser SSR extraction.

## Workflows

### Find accommodations
1. `searchListings(query, checkin, checkout, adults)` → pick listing → `id`
2. `getListingDetail(id, checkin, checkout)` → full property info, amenities, host, ratings

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchListings | find places to stay | query, checkin, checkout, adults | id, title, name, price, rating, roomInfo, photos | entry point; 18 results per page |
| getListingDetail | full listing info | id ← searchListings | title, description, overallRating, reviewCount, host, amenities, highlights | requires listing ID |

## Quick Start

```bash
# Search listings in Tokyo
openweb airbnb exec searchListings '{"query":"Tokyo","checkin":"2026-05-01","checkout":"2026-05-03","adults":2}'

# Get listing details (use id from search results)
openweb airbnb exec getListingDetail '{"id":"20713816","checkin":"2026-05-01","checkout":"2026-05-03"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.

## API Architecture
- **No JSON APIs** — all data is SSR-delivered via `<script id="data-deferred-state-0" type="application/json">`
- Data path: `niobeClientData[0][1].data.presentation.staysSearch` (search) / `stayProductDetailPage` (detail)
- Search results contain 18 listings per page with cursor-based pagination
- Listing IDs are base64-encoded in `demandStayListing.id` (format: `DemandStayListing:<numeric_id>`)
- Detail pages use a section-based architecture with 33 sections (REVIEWS_DEFAULT, LOCATION_DEFAULT, etc.)

## Auth
No auth required for public browsing and search.

## Transport
- `transport: page` — browser-only access required
- All data is embedded in the initial SSR HTML; no separate API calls to intercept
- Adapter extracts from `data-deferred-state-0` JSON embedded in `<script>` tags

## Extraction
- All operations use the `airbnb-web` adapter (`adapters/airbnb-web.ts`)
- Search: navigates to `/s/homes?query=...`, extracts from SSR `staysSearch` data
- Detail: navigates to `/rooms/<id>`, extracts from SSR `stayProductDetailPage` sections

## Known Issues
- **SSR-only data** — no JSON APIs; all data comes from embedded script tags
- **No pagination support** — only first page of results (18 listings) is returned
- **Dynamic pricing** — prices vary by dates, currency, and user session
- **Listing IDs** — extracted from base64-encoded `demandStayListing.id`; `propertyId` field is null in search results
