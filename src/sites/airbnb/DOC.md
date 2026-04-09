# Airbnb

## Overview
Travel marketplace — accommodation search, listing details, reviews, availability, and host profiles via browser SSR extraction.

## Workflows

### Find accommodations
1. `searchListings(query, checkin, checkout, adults)` → pick listing → `id`
2. `getListingDetail(id, check_in, check_out)` → full property info, amenities, host, ratings

### Evaluate a listing
1. `getListingReviews(id)` → guest reviews and ratings breakdown
2. `getListingAvailability(id, check_in, check_out)` → pricing, booking, and policy info

### Research a host
1. `getHostProfile(hostId)` → superhost status, response rate, about, listings

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchListings | find places to stay | query, checkin, checkout, adults | id, title, price, rating, photos | entry point; 18 results per page |
| getListingDetail | full listing info | id ← searchListings | title, description, overallRating, host, amenities | requires listing ID |
| getListingReviews | guest reviews | id ← searchListings | reviewSections (ratings, review text, reviewer) | adapter; extracts REVIEW sections |
| getListingAvailability | pricing and availability | id, check_in, check_out | availabilitySections (booking, pricing, policies) | adapter; date params optional |
| getHostProfile | host info | hostId ← getListingDetail | profile (superhost, response rate, about, listings) | adapter; uses /users/show/{hostId} |

## Quick Start

```bash
# Search listings in Tokyo
openweb airbnb exec searchListings '{"query":"Tokyo","checkin":"2026-05-01","checkout":"2026-05-03","adults":2}'

# Get listing details (use id from search results)
openweb airbnb exec getListingDetail '{"id":"20713816","check_in":"2026-05-01","check_out":"2026-05-03"}'

# Get reviews for a listing
openweb airbnb exec getListingReviews '{"id":"20713816"}'

# Get availability with dates
openweb airbnb exec getListingAvailability '{"id":"20713816","check_in":"2026-06-01","check_out":"2026-06-05"}'

# Get host profile (hostId from listing detail host section)
openweb airbnb exec getHostProfile '{"hostId":"70270073"}'
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
- Search and detail use declarative `script_json` extraction
- Reviews, availability, and host profile use the `airbnb-web` adapter (`adapters/airbnb-web.ts`) for section filtering

## Extraction
- **Search/Detail:** declarative `script_json` extraction from `#data-deferred-state-0`
- **Reviews:** adapter navigates to `/rooms/{id}`, extracts SSR, filters for REVIEW sections
- **Availability:** adapter navigates to `/rooms/{id}` with date params, filters for BOOK/AVAILABILITY/PRICE/POLICIES sections
- **Host profile:** adapter navigates to `/users/show/{hostId}`, extracts full SSR presentation data

## Known Issues
- **SSR-only data** — no JSON APIs; all data comes from embedded script tags
- **No pagination support** — only first page of results (18 listings) is returned
- **Dynamic pricing** — prices vary by dates, currency, and user session
- **Listing IDs** — extracted from base64-encoded `demandStayListing.id`; `propertyId` field is null in search results
- **Reviews limited** — adapter returns SSR-embedded reviews (typically first 6-10); full reviews load via GraphQL modal
