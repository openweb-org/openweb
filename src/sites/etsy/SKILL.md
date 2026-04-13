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
