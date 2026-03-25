# Amazon

## Overview
E-commerce. Amazon.com — product search, product details, and customer reviews via browser DOM extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | GET /s?k={keyword} | returns ASIN, title, price, rating, review count, image |
| getProductDetail | product detail page | GET /dp/{asin} | title, price, rating, brand, availability, features, description, image |
| getProductReviews | customer reviews | GET /product-reviews/{asin} | overall rating, total count, individual reviews with author/rating/title/body |

## API Architecture
- **Traditional SSR** — no Next.js, no public JSON APIs for core data
- All search results, product details, and reviews are rendered server-side into HTML
- Amazon uses `data-a-state` attributes for embedded JSON fragments in the DOM, but these are widget-specific (cart, recommendations) — not the primary product data
- `data.amazon.com/api/marketplaces/ATVPDKIKX0DER/products/{asin}` exists as a JSON endpoint for individual products (delivery info, pricing), but does not cover search or reviews
- Internal endpoints: `/dram/renderLazyLoaded` (lazy-loaded cards), `/rufus/cl/streaming` (AI assistant), `/suggestions` (autocomplete) — none suitable as primary operations
- Heavy analytics traffic: `unagi.amazon.com`, `fls-na.amazon.com` — all noise

## Auth
- No auth needed for public product data (search, detail, reviews)
- `requires_auth: false`
- `cookie_session` declared for server config — cookies present but not needed for read operations

## Transport
- `transport: page` — requires managed browser
- Amazon has aggressive bot detection (proprietary, not a known third-party like PerimeterX)
- Direct HTTP/node fetch receives either CAPTCHA challenges or degraded HTML
- Browser must already be navigated to the correct page URL before extraction runs — the runtime matches by origin, does NOT navigate

## Extraction
- `page_global_data` on all 3 operations — JavaScript evaluated in-page to query DOM selectors
- **Search** (`/s`): queries `[data-component-type="s-search-result"]` elements, extracts ASIN from `data-asin` attribute, title from `h2 span`, price from `.a-price-whole`/`.a-price-fraction`, rating from `.a-icon-alt`
- **Product detail** (`/dp/{asin}`): queries named elements — `#productTitle`, `.a-price .a-offscreen`, `#acrPopover`, `#bylineInfo`, `#feature-bullets li span`, `#landingImage`
- **Reviews** (`/product-reviews/{asin}`): queries `[data-hook="review"]` elements with `data-hook` sub-selectors for author, star rating, title, date, body, verified badge

## Known Issues
- **Browser page requirement** — extraction operations require the browser to already be on the matching page. The runtime finds a page by origin match only; it does not navigate to the operation URL. Callers must navigate the browser first.
- **Lazy-loaded search results** — Amazon lazy-loads search results on scroll. Initial page load may yield fewer results (2–22 depending on timing). Full results require scrolling.
- **`url` field nullable** — search result link extraction is fragile; `h2 a` href is sometimes null. Schema allows `[string, null]`.
- **`helpful` field nullable** — review "helpful vote" count is only present on reviews that have received votes.
- **International reviews** — Amazon sometimes serves reviews from other marketplaces (e.g., Japan). Review language may not match the .com domain.
- **DOM selectors may drift** — Amazon's HTML class names and structure change periodically. Selectors like `.a-price-whole`, `#productTitle` are stable identifiers, but less standard ones may break.
