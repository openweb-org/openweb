# JD.com

## Overview
Chinese e-commerce (京东). Product search, detail, reviews, and pricing via DOM extraction.

## Workflows

### Search and view product
1. `searchProducts(keyword)` → products with `skuId`
2. `getProductDetail(skuId)` → full product info
3. `getProductPrice(skuId)` → current price and promotions

### Check reviews before buying
1. `searchProducts(keyword)` → pick product → `skuId`
2. `getProductReviews(skuId)` → review count, good rate, individual reviews

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword, page? | skuId, name, price, shopName, sales | entry point, 30/page |
| getProductDetail | product detail by SKU | skuId ← searchProducts | name, price, images, variants, reviewCount | pageConfig + DOM |
| getProductReviews | product reviews by SKU | skuId ← searchProducts | totalCount, goodRate, tags, reviews | DOM extraction |
| getProductPrice | product price by SKU | skuId ← searchProducts | currentPrice, originalPrice, inStock, promotions | DOM extraction |

## Quick Start

```bash
# Search for phones
openweb jd exec searchProducts '{"keyword":"手机"}'

# Get product detail
openweb jd exec getProductDetail '{"skuId":"100085781898"}'

# Get reviews
openweb jd exec getProductReviews '{"skuId":"100085781898"}'

# Get price
openweb jd exec getProductPrice '{"skuId":"100085781898"}'
```
