# Amazon Fixture — Progress

## 2026-03-26: Expand coverage from 3 to 6 ops

**What changed:**
- Added getProductQA: extracts Rufus AI suggested questions from product detail page (`#dpx-nice-widget-container .small-widget-pill`)
- Added getDeals: extracts deal cards from `/deals` page (`.dcl-product` cards with discount %, price, timer)
- Added addToCart: adapter-based write operation that reads `#addToCart` form and POSTs to buy-box handler
- Created `adapters/amazon-cart.ts` for the addToCart adapter
- Updated manifest.json: operation_count 3→6, l3_count 0→1

**Why:**
- Expanding coverage to include deals discovery, product Q&A context, and cart interaction
- Amazon's Q&A has been replaced by Rufus AI widget — traditional `/ask/questions/asin/` URL returns 404
- Deals page uses event-specific URLs (e.g., `/events/bigspringsale`) but card structure is consistent

**Verification:**
- Build: `pnpm build` exits 0
- Spec validation: passed (after removing invalid `page_match` property from extraction)
- Read ops (getProductQA, getDeals): verified DOM selectors against live page structure via CDP
- Write op (addToCart): `verified: false` — form structure confirmed, adapter written but not triggered during verification

**Commit:** pending

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created amazon with 3 operations: searchProducts, getProductDetail, getProductReviews
- All operations use `page` transport with `page_global_data` extraction (DOM selectors)
- Added test cases for all 3 operations
- Fixed nullable schema fields (`url`, `helpful`) after content-level verification

**Why:**
- Amazon is a traditional SSR site — no `__NEXT_DATA__`, no public JSON APIs for search/reviews
- The compile tool requires JSON responses and filtered out all Amazon traffic (HTML pages + analytics noise)
- Manual fixture creation was necessary, using `page_global_data` extraction with JavaScript DOM queries
- Capture contention with other agents (yelp, walmart, bestbuy, costco workers sharing the same CDP browser) required creating dedicated tabs via CDP API

**Verification:**
- API-level: all 3 operations return status 200 with structured JSON
- Content-level: search returns 22 products with titles, prices, ratings, images matching what the browser displays
- Content-level: product detail returns full info (title, $21.99, 4.2 stars, brand, 5 features, image URL)
- Content-level: reviews return 3 individual reviews with author, rating, title, date, body, verified badge
- Build: `pnpm build` exits 0

**Commit:** d8dc743 (initial scaffold), f740be0 (tests + nullable fixes)

## Discovery Notes

- Amazon's bot detection did NOT block the managed browser (no CAPTCHA on any page)
- The `data.amazon.com/api/marketplaces/ATVPDKIKX0DER/products/{asin}` JSON endpoint exists but only covers individual product delivery/pricing — not search or reviews
- Amazon search results lazy-load on scroll; initial extraction gets 2–22 items depending on page load timing
- International reviews from other Amazon marketplaces (JP) appear on .com product review pages
