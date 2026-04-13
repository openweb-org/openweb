# Target

## Overview
Target.com — major US e-commerce retailer. Product search, detail, store availability, and cart management via internal Redsky aggregation and cart APIs.

## Workflows

### Search and inspect products
1. `searchProducts(keyword)` → browse results → `tcin`
2. `getProductDetail(tcin)` → full product info with variants

### Check store availability
1. `searchProducts(keyword)` → pick product → `tcin`
2. `getStoreAvailability(tcin, nearby)` → stock levels, pickup times by store

### Add to cart
1. `searchProducts(keyword)` → pick product → `tcin`
2. `addToCart(tcin)` → cart confirmation with pricing → `cart_item_id`

### Remove from cart
1. `addToCart(tcin)` → note `cart_item_id` from response
2. `removeFromCart(cart_item_id)` → updated cart summary

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | tcin, title, price, rating, images | entry point; returns HTTP 206 |
| getProductDetail | full product detail by TCIN | tcin ← searchProducts | title, description, price, ratings, variants, brand | |
| getStoreAvailability | per-store stock and pickup times | tcin ← searchProducts, nearby (zip code) | stock qty, pickup SLA, store name/address | |
| addToCart | add product to cart | tcin ← searchProducts | cart_id, cart_item_id, quantity, unit_price, fulfillment | CAUTION: adds to cart only, never checkout |
| removeFromCart | remove item from cart | cart_item_id ← addToCart | cart_id, total_cart_item_quantity, removed_cart_item_id | CAUTION: reverses addToCart |

## Quick Start

```bash
# Search for products
openweb target exec searchProducts '{"keyword": "headphones"}'

# Get full detail for a product
openweb target exec getProductDetail '{"tcin": "92750139"}'

# Check store availability near a zip code
openweb target exec getStoreAvailability '{"tcin": "91938794", "nearby": "95125"}'

# Add to cart then remove
openweb target exec addToCart '{"cart_item": {"tcin": "91252434"}}'
# → note cart_item_id from response
openweb target exec removeFromCart '{"cart_item_id": "<cart_item_id>"}'
```
