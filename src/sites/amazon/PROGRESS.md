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
