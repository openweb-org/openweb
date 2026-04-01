# Best Buy

## Overview
E-commerce — electronics retailer. Three read APIs for product search, details, and pricing, plus one write API for add-to-cart.

## Workflows

### Search and compare products
1. `searchProducts(query)` → suggestion terms, categories, and `skuId` list
2. `getProductDetails(skuids ← searchProducts)` → name, image, rating, review count
3. `getProductPricing(skus ← searchProducts)` → current/regular price, savings, availability

### Search and add to cart
1. `searchProducts(query)` → `skuId` list
2. `getProductPricing(skus ← searchProducts)` → confirm price and availability
3. `addToCart(skuId ← searchProducts)` → cart count, subtotal

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search by keyword | query | terms, categories, skuId[] | entry point |
| getProductDetails | product info by SKU | skuids ← searchProducts | name, image, rating, reviewCount | comma-separated SKUs |
| getProductPricing | pricing by SKU | skus ← searchProducts | currentPrice, regularPrice, savings, availability | comma-separated SKUs |
| addToCart | add product to cart | skuId ← searchProducts | cartCount, subtotal, itemPrice | write / caution |

## Quick Start

```bash
# Search for products
openweb bestbuy exec searchProducts '{"query":"laptop","count":5}'

# Get product details for specific SKUs
openweb bestbuy exec getProductDetails '{"skuids":"6638906,6612975"}'

# Get pricing for specific SKUs
openweb bestbuy exec getProductPricing '{"skus":"6614950"}'
```

---

## Site Internals

## API Architecture
- REST, same-origin on `www.bestbuy.com`
- `searchProducts` is the typeahead/suggestion API — returns top ~9 products per term with SKU IDs
- `priceBlocks` is the canonical pricing API with rich data (offers, open-box, protection plans) for up to ~10 SKUs per call
- `x-client-id: Search-Web-View` header required on suggest endpoints (has default in spec)

## Auth
- cookie_session (Akamai-managed session cookies)
- No user login required for public data
- Cookies set automatically when browsing bestbuy.com

## Transport
- **page** — required due to Akamai bot protection
- Direct HTTP (curl, node fetch) blocked with HTTP/2 protocol errors
- Homepage or search page is sufficient as the open page

## Known Issues
- **Akamai bot protection**: All requests must go through page transport. Direct HTTP is blocked.
- **SKU format**: Some newer SKUs (e.g. 12009400) return 404 on priceBlocks — may be virtual/bundle SKUs. Older 7-digit SKUs (e.g. 6614950) work reliably.
- **Compiler incompatible**: `pnpm dev compile` filters out all captured traffic — manual fixture creation required.
