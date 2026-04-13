# Home Depot

## Overview
Home improvement retailer (archetype: e-commerce). homedepot.com — product search, details, reviews, pricing, and store availability via GraphQL federation gateway interception.

## Workflows

### Find and compare products
1. `searchProducts(keyword)` → browse results → `itemId`
2. `getProductDetail(itemId)` → full specs, price, availability

### Research product reviews
1. `searchProducts(keyword)` → `itemId`
2. `getProductReviews(itemId)` → customer reviews, ratings, photos

### Compare pricing and promotions
1. `searchProducts(keyword)` → `itemId`
2. `getProductPricing(itemId)` → sale price, original price, promotions, BOGO deals

### Check store availability before visiting
1. `searchProducts(keyword)` → `itemId`
2. `getStoreAvailability(itemId)` → pickup/delivery options, in-stock quantity, store info

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | itemId, name, brand, price, rating, reviewCount | entry point; navigates to /s/{keyword} |
| getProductDetail | full product info | itemId <- searchProducts | name, brand, price, description, specs, images, availability | storeId/zipCode for local pricing |
| getProductReviews | customer reviews | itemId <- searchProducts | totalReviews, reviews (rating, text, author, photos, badges) | BazaarVoice-sourced; 10 reviews per page |
| getProductPricing | detailed pricing | itemId <- searchProducts | price, originalPrice, promotions, conditionalPromotions, unitPricing | includes BOGO and clearance info |
| getStoreAvailability | store pickup/delivery | itemId <- searchProducts | fulfillmentOptions (pickup, delivery), in-stock quantity, store info | uses browser's current store context |

## Quick Start

```bash
# Search for products
openweb homedepot exec searchProducts '{"keyword": "cordless drill"}'

# Get full product details by item ID
openweb homedepot exec getProductDetail '{"itemId": "306283873"}'

# Product detail with local store pricing
openweb homedepot exec getProductDetail '{"itemId": "306283873", "zipCode": "10001"}'

# Get customer reviews
openweb homedepot exec getProductReviews '{"itemId": "306283873"}'

# Get detailed pricing info (promotions, unit pricing, clearance)
openweb homedepot exec getProductPricing '{"itemId": "306283873"}'

# Check store availability (pickup and delivery options)
openweb homedepot exec getStoreAvailability '{"itemId": "306283873"}'
```
