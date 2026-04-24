## 2026-04-24: Userflow QA — response trimming and fixes

**Personas tested:**
1. Parent — searched "kids backpack", checked reviews
2. Tech enthusiast — searched "wireless noise cancelling headphones", checked detail
3. Home chef — searched "cast iron skillet", checked detail and reviews

**What changed:**
- searchProducts: fixed grid-layout title extraction — Amazon renders brand in h2 and product name in separate `a.s-line-clamp` element; now combines both when they differ
- getProductReviews: switched from `/product-reviews/` (now requires sign-in, returned empty) to extracting reviews from `/dp/` product page; fixed title selector that picked up star rating text instead of actual title; removed pageNumber/sortBy params from spec (product page shows top ~8 reviews, no pagination)
- getProductDetail: cleaned brand field (strip "Visit the X Store" prefix/suffix), added fallback to product overview table when `#bylineInfo` absent; stripped parentheses from reviewCount; fixed description selector that returned heading text "Product Description" instead of content
- getBestSellers: added domain prefix to relative links

**Why:**
- searchProducts grid layout is served for certain categories (kids products, apparel) — brand-only titles made results unusable for agents
- Amazon's standalone reviews page now requires authentication, breaking getProductReviews entirely
- Brand/reviewCount/description issues produced noisy or incorrect data for agents

**Verification:** pnpm dev verify amazon pending

## 2026-04-09: Add cart operations (addToCart, getCart)

**What changed:**
- Added addToCart (write op) — navigates to product page, clicks Add to Cart, extracts confirmation with cart count and subtotal
- Added getCart (read op) — navigates to cart page, extracts items with ASIN, title, price, quantity, image
- Both operations use adapter lane with page transport (Akamai requires browser)
- addToCart marked with safety: caution (reversible write)
- Updated DOC.md with cart workflow, operations table, quick start examples
- Total operations: 7 (was 5)

**Why:**
- Cart operations are core e-commerce interactions missing from the initial package
- addToCart is a safe, reversible write op suitable for agent automation

**Verification:** pending browser verify

## 2026-04-01: Initial discovery and compilation

**What changed:**
- Created Amazon site package with 5 operations: searchProducts, getProductDetail, getProductReviews, searchDeals, getBestSellers
- Captured 6081 requests across 74 pages, 365 labeled as API traffic
- Auto-curation produced 57 HTTP ops and 18 WS ops — curated down to 5 targeted operations
- Set page transport (Akamai Bot Manager blocks node)
- Configured html_selector extraction for search/reviews/best-sellers, script_json for product detail
- searchDeals uses real JSON API at /d2b/api/v1/products/search

**Why:**
- User requested Amazon site package with searchProducts, getProductDetail, getProductReviews, getDeals targets
- Amazon's Akamai Bot Manager prevents direct Node.js HTTP — page transport mandatory
- Most Amazon content is SSR HTML, requiring extraction patterns

**Verification:** compile-time verify (page transport ops pending browser verify)
