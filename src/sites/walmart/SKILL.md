# Walmart

## Overview
E-commerce. Walmart.com — product search, detail pages, pricing, and cart operations. Read ops use Next.js SSR extraction; write ops use an adapter with persisted GraphQL mutations via browser context.

## Workflows

### Search and view product
1. `searchProducts(q)` → browse results → `usItemId`
2. `getProductDetail(slug, itemId)` → full product info (name, brand, price, reviews, images)

### Compare pricing
1. `searchProducts(q)` → find products → `usItemId`
2. `getProductPricing(itemId)` → currentPrice, wasPrice, savingsAmount, isPriceReduced

### Search and add to cart
1. `searchProducts(q)` → browse results → `usItemId`
2. `addToCart(usItemId, quantity)` → cartId, cartCount, item details

### Remove from cart
1. `searchProducts(q)` or prior `addToCart` → `usItemId`
2. `removeFromCart(usItemId)` → cartId, cartCount, removedItemId

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | q | name, usItemId, linePrice, averageRating | entry point; returns itemStacks |
| getProductDetail | full product page | slug, itemId ← searchProducts | name, brand, priceInfo, averageRating, numberOfReviews, imageInfo | slug can be any string |
| getProductPricing | focused pricing info | itemId ← searchProducts | currentPrice, wasPrice, savingsAmount, isPriceReduced | subset of product detail |
| addToCart | add product to cart | usItemId ← searchProducts, quantity | cartId, cartCount, item | ⚠️ write op, adapter-based |
| removeFromCart | remove product from cart | usItemId ← addToCart | cartId, cartCount, removedItemId | ⚠️ write op, reverses addToCart |

## Quick Start

```bash
# Search for products
openweb walmart exec searchProducts '{"q": "laptop"}'

# Get full product detail (slug can be any non-empty string)
openweb walmart exec getProductDetail '{"slug": "item", "itemId": "5113175776"}'

# Get focused pricing
openweb walmart exec getProductPricing '{"itemId": "5113175776"}'

# Add to cart (requires browser page on walmart.com)
openweb walmart exec addToCart '{"usItemId": "5113175776", "quantity": 1}'

# Remove from cart (requires browser page on walmart.com)
openweb walmart exec removeFromCart '{"usItemId": "5113175776"}'
```
