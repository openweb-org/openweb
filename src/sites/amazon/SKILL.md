# Amazon

## Overview
E-commerce marketplace — search products, view details, read reviews, browse deals, manage cart.

## Workflows

### Search and view product details
1. `searchProducts(k)` → product list with `asin`
2. `getProductDetail(asin)` → full product info (name, price, brand, rating)
3. `getProductReviews(asin)` → customer reviews

### Browse deals
1. `searchDeals(startIndex, pageSize)` → deal products with pricing and badges
2. `getProductDetail(asin)` ← asin from deal product → full product info

### Discover trending products
1. `getBestSellers` → ranked best-selling products

### Cart operations
1. `searchProducts(k)` → `asin`
2. `addToCart(asin)` → `cartCount`, `subtotal`
3. `getCart` → cart items with `asin`, `title`, `quantity`, `subtotal`
4. `removeFromCart(asin ← getCart)` → updated cart

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | k (query) | asin, title, price, rating | entry point; paginated (page param) |
| getProductDetail | view full product info | asin ← searchProducts | name, price, brand, description, rating, reviewCount | DOM selector extraction |
| getProductReviews | read customer reviews | asin ← searchProducts | rating, title, body, author, date | paginated (pageNumber); sortBy: recent/helpful |
| searchDeals | browse active deals | startIndex, pageSize | asin, title, price, dealBadge, percentClaimed | JSON API; paginated (nextIndex) |
| getBestSellers | view best sellers | — | title, price, rating, link | entry point |
| addToCart | add product to cart | asin ← searchProducts, quantity? | success, cartCount, subtotal | write op; clicks Add to Cart, verifies via cart JSON API |
| removeFromCart | remove product from cart | asin ← getCart | success, cartCount, subtotal | write op; reverse of addToCart; clicks Delete in cart |
| getCart | view cart contents | — | items (asin, title, price, quantity), subtotal | JSON API + DOM enrichment |

## Quick Start

```bash
# Search for products
openweb amazon exec searchProducts '{"k": "laptop"}'

# Get product details by ASIN
openweb amazon exec getProductDetail '{"asin": "B00MVWGQX0"}'

# Get product reviews
openweb amazon exec getProductReviews '{"asin": "B00MVWGQX0"}'

# Browse current deals
openweb amazon exec searchDeals '{"startIndex": 1, "pageSize": 20}'

# View best sellers
openweb amazon exec getBestSellers '{}'

# Add product to cart
openweb amazon exec addToCart '{"asin": "B00MVWGQX0"}'

# Remove product from cart
openweb amazon exec removeFromCart '{"asin": "B00MVWGQX0"}'

# View cart
openweb amazon exec getCart '{}'
```
