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

---

## Site Internals

## API Architecture
- REST JSON APIs on `redsky.target.com` (read aggregation) and `carts.target.com` (cart mutations) — both dedicated subdomains separate from `www.target.com`
- Read endpoints follow the pattern `/redsky_aggregations/v1/web/<aggregation_name>`
- Cart endpoints use `/web_checkouts/v1/cart_items` — POST to add, DELETE `/{cart_item_id}` to remove
- Static API key required as `key` query param (embedded in frontend JS): `9f36aeafbe60771e321a7cc95a78140772ab3e96`
- Search returns HTTP 206 (Partial Content) — `count`/`offset` control pagination
- Product IDs are called TCINs (Target item IDs), e.g. `92750139`

## Auth
No auth required — static API key only. `visitor_id` param is accepted but optional.

## Transport
- **node** — direct HTTP fetch works for all Redsky aggregation APIs and cart APIs
- PerimeterX bot detection is active on `www.target.com` but NOT on the API subdomains `redsky.target.com` and `carts.target.com`

## Extraction
Direct JSON responses — no SSR extraction needed. All APIs wrap data in `{ "data": { ... } }`.

## Known Issues
- **API key may rotate** — the static key `9f36aeafbe60771e321a7cc95a78140772ab3e96` is embedded in frontend JS and could change with deploys
- **`store_id` and `pricing_store_id` affect pricing** — different stores may show different prices; default `2281` is San Jose Central
- **Search returns 206, not 200** — clients must accept HTTP 206
- **addToCart and removeFromCart are unverified** — write ops, require manual testing
- **removeFromCart requires cart_item_id** — must be obtained from addToCart response; there is no "remove by tcin" convenience
