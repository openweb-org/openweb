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
