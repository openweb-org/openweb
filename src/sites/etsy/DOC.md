# Etsy

## Overview
Handmade and vintage marketplace — search listings, view details, shop profiles, and reviews.

## Workflows

### Search and view listing
1. `searchListings(query)` → results with `listingId`, `shopName`
2. `getListingDetail(listingId)` → full listing info (title, price, description, photos, seller)

### Read listing reviews
1. `searchListings(query)` → `listingId`
2. `getReviews(listingId)` → reviews with aggregate rating

### Browse a shop
1. `searchListings(query)` → `shopName` from result
2. `getShop(shopName)` → shop profile (rating, sales, location, owner)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchListings | search items by keyword | query | listingId, title, price, shopName, rating | entry point |
| getListingDetail | full listing info | listingId ← searchListings | title, price, description, photos, shopName, material | |
| getReviews | listing reviews | listingId ← searchListings | averageRating, totalReviews, reviews[] | LD+JSON provides ~4 recent reviews |
| getShop | shop profile | shopName ← searchListings | name, location, rating, sales, owner, activeListings | |

## Quick Start

```bash
# Search for handmade pottery
openweb etsy exec searchListings '{"query":"handmade pottery"}'

# Get listing details
openweb etsy exec getListingDetail '{"listingId":"168685596"}'

# Get reviews for a listing
openweb etsy exec getReviews '{"listingId":"168685596"}'

# Get shop profile
openweb etsy exec getShop '{"shopName":"nealpottery"}'
```

---

## Site Internals

## API Architecture
- No usable JSON data APIs — bespoke endpoints return HTML fragments (`output` + `jsData`), not structured data
- Internal APIs at `/api/v3/ajax/bespoke/` and `/api/v3/ajax/public/` serve rendered components
- All data extraction uses schema.org LD+JSON blocks and SSR-rendered DOM

## Auth
No auth required. All operations are public read-only.

## Transport
- `page` transport for all operations (adapter-based)
- Bot detection: Cloudflare (`cf_clearance`) + PerimeterX (`_px3`, `_pxvid`) + DataDome — blocks all direct HTTP
- Adapter file: `adapters/etsy.ts`

## Extraction
- **Search**: DOM extraction from `a[data-listing-id]` cards — provides title, price, shop, rating
- **Listing detail**: LD+JSON `Product` — name, sku, description, image, brand, aggregateRating, offers, material
- **Reviews**: LD+JSON `Product.review` array (~4 recent reviews) + `aggregateRating`
- **Shop**: LD+JSON `Organization` — name, description, location, logo, slogan, employee, aggregateRating; DOM for sales count and years on Etsy

## Known Issues
- LD+JSON on search pages contains only ~11 items; adapter uses DOM extraction for full results
- Review data from LD+JSON is limited to ~4 recent reviews; aggregate stats are complete
- Heavy bot detection means direct HTTP is not viable — page transport required
