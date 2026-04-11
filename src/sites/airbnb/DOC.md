# Airbnb

## Overview
Travel marketplace — accommodation search, listing details, reviews, availability, and host profiles via Node fetch + direct GraphQL API.

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
| getListingReviews | guest reviews | id ← searchListings | reviews[], reviewsCount, overallRating, ratings | adapter; direct GraphQL API |
| getListingAvailability | pricing and availability | id, check_in, check_out | calendarMonths[] (date, available, price) | adapter; direct GraphQL API |
| getHostProfile | host info | hostId ← getListingDetail | profile (superhost, response rate, about, listings) | adapter; browser SSR from /users/show/{hostId} |

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

### API Architecture
- **Dual transport**: 4/5 ops use Node.js fetch directly (zero browser); 1 op (getHostProfile) requires browser SSR
- **Search/Detail**: Node fetch to `www.airbnb.com` pages → parse SSR JSON from `<script id="data-deferred-state-0">`
- **Reviews/Availability**: Direct GraphQL API calls to `/api/v3/` with persisted query hashes, API key `d306zoyjsyarp7ifhu67rjxn52tv0t20`
- **Host Profile**: Browser SSR extraction (bot detection blocks Node fetch to `/users/show/`)
- Search results contain 18 listings per page with cursor-based pagination
- GraphQL requires platform headers: `X-Airbnb-GraphQL-Platform-Client: minimalist-niobe`, `X-Airbnb-GraphQL-Platform: web`

### Auth
No auth required for public browsing and search.

### Transport
- **4/5 ops**: Node fetch — zero browser dependency (search, detail, reviews, availability)
- **1/5 ops**: Browser SSR — getHostProfile requires page transport (bot detection on `/users/show/`)
- Adapter (`adapters/airbnb.ts`) handles all 5 ops with transport auto-detection

### Extraction
- **Search/Detail:** Node fetch HTML → parse `#data-deferred-state-0` JSON (data path: `niobeClientData[0][1].data.presentation.staysSearch`)
- **Reviews:** Direct GraphQL API call (`StaysPdpReviewsQuery` persisted query hash)
- **Availability:** Direct GraphQL API call (`PdpAvailabilityCalendar` persisted query hash)
- **Host profile:** Browser SSR extraction from `/users/show/{hostId}`

### Known Issues
- **Persisted query hashes** are deployment-specific — may break if Airbnb rotates them
- **No pagination support** — only first page of results (18 listings) is returned
- **Dynamic pricing** — prices vary by dates, currency, and user session
- **Listing IDs** — extracted from base64-encoded `demandStayListing.id`; `propertyId` field is null in search results
- **Reviews limited** — returns first page of reviews via API (typically 7); full set requires pagination
