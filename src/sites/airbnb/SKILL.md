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
