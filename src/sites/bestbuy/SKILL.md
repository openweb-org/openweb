# Best Buy

## Overview
E-commerce — electronics retailer. Three read APIs for product search, details, and pricing, plus write APIs for add-to-cart and remove-from-cart.

## Workflows

### Search and compare products
1. `searchProducts(query)` → suggestion terms, categories, and `skuId` list
2. `getProductDetails(skuids ← searchProducts)` → name, image, rating, review count
3. `getProductPricing(skus ← searchProducts)` → current/regular price, savings, availability

### Search and add to cart
1. `searchProducts(query)` → `skuId` list
2. `getProductPricing(skus ← searchProducts)` → confirm price and availability
3. `addToCart(skuId ← searchProducts)` → cart count, subtotal, `lineId`

### Remove from cart
1. `addToCart(skuId)` → `lineId` in summaryItems
2. `removeFromCart(lineId ← addToCart)` → updated cart count, subtotal

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search by keyword | query | terms, categories, skuId[] | entry point |
| getProductDetails | product info by SKU | skuids ← searchProducts | name, image, rating, reviewCount | comma-separated SKUs |
| getProductPricing | pricing by SKU | skus ← searchProducts | currentPrice, regularPrice, savings, availability | comma-separated SKUs |
| addToCart | add product to cart | skuId ← searchProducts | cartCount, subtotal, lineId | write / caution |
| removeFromCart | remove product from cart | lineId ← addToCart | cartCount, subtotal | write / caution, reverse of addToCart |

## Quick Start

```bash
# Search for products
openweb bestbuy exec searchProducts '{"query":"laptop","count":5}'

# Get product details for specific SKUs
openweb bestbuy exec getProductDetails '{"skuids":"6638906,6612975"}'

# Get pricing for specific SKUs
openweb bestbuy exec getProductPricing '{"skus":"6614950"}'

# Add to cart (returns lineId for removal)
openweb bestbuy exec addToCart '{"items":[{"skuId":"6614950"}]}'

# Remove from cart
openweb bestbuy exec removeFromCart '{"items":[{"lineId":"<lineId-from-addToCart>"}]}'
```
