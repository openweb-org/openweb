# Amazon

## Overview
E-commerce. Amazon.com — product search, product details, customer reviews, Q&A, deals, and cart via browser DOM extraction.

## Operations
| Operation | Intent | Method | Safety | Notes |
|-----------|--------|--------|--------|-------|
| searchProducts | search by keyword | GET /s?k={keyword} | read | returns ASIN, title, price, rating, review count, image |
| getProductDetail | product detail page | GET /dp/{asin} | read | title, price, rating, brand, availability, features, description, image |
| getProductReviews | customer reviews | GET /product-reviews/{asin} | read | overall rating, total count, individual reviews with author/rating/title/body |
| getProductQA | suggested Q&A questions | GET /internal/productQA/{asin} | read | Rufus AI suggested questions from the product detail page widget |
| getDeals | current deals/discounts | GET /deals | read | deal cards with ASIN, title, discount %, current price, original price, timer |
| addToCart | add product to cart | POST /internal/addToCart | write | adapter-based, reads form from product page, POSTs to buy-box handler. NEVER checkouts. |

## API Architecture
- **Traditional SSR** — no Next.js, no public JSON APIs for core data
- All search results, product details, and reviews are rendered server-side into HTML
- Amazon uses `data-a-state` attributes for embedded JSON fragments in the DOM, but these are widget-specific (cart, recommendations) — not the primary product data
- Deals page (`/deals` or `/events/*`) uses `.dcl-product` card components with `[data-testid="discount-asin-grid"]` container
- Q&A has been replaced by Rufus AI widget (`#dpx-nice-widget-container`) with `.small-widget-pill` suggested questions — no traditional community Q&A page
- Heavy analytics traffic: `unagi.amazon.com`, `fls-na.amazon.com` — all noise
- Add-to-cart uses form POST to `/gp/product/handle-buy-box/` with CSRF token, offer listing ID, session data from `#addToCart` form

## Auth
- No auth needed for public product data (search, detail, reviews, Q&A, deals)
- `requires_auth: false`
- `cookie_session` declared for server config — cookies present but not needed for read operations
- addToCart works in guest mode (cart persisted via session cookie)
- Amazon uses custom `x-amzn-*` request signing headers computed client-side for some internal APIs

## Transport
- `transport: page` — requires managed browser
- Amazon has aggressive bot detection: **Akamai Bot Manager** (`_abck` cookie, sensor fingerprinting)
- Direct HTTP/node fetch receives either CAPTCHA challenges or degraded HTML
- Browser must already be navigated to the correct page URL before extraction runs — the runtime matches by origin, does NOT navigate
- Keep capture sessions short, use real Chrome profile

## Extraction
- `page_global_data` on read operations — JavaScript evaluated in-page to query DOM selectors
- **Search** (`/s`): queries `[data-component-type="s-search-result"]` elements, extracts ASIN from `data-asin` attribute, title from `h2 span`, price from `.a-price-whole`/`.a-price-fraction`, rating from `.a-icon-alt`
- **Product detail** (`/dp/{asin}`): queries named elements — `#productTitle`, `.a-price .a-offscreen`, `#acrPopover`, `#bylineInfo`, `#feature-bullets li span`, `#landingImage`
- **Reviews** (`/product-reviews/{asin}`): queries `[data-hook="review"]` elements with `data-hook` sub-selectors for author, star rating, title, date, body, verified badge
- **Q&A** (`/internal/productQA/{asin}`): queries `#dpx-nice-widget-container .small-widget-pill` buttons for Rufus AI suggested questions
- **Deals** (`/deals`): queries `.dcl-product` cards for ASIN (from link href), discount badge, price elements, countdown timer
- **Add to Cart** (`/internal/addToCart`): adapter (`amazon-cart.ts`) reads `#addToCart` form inputs, POSTs via `page.request.fetch()` inheriting browser cookies

## Known Issues
- **Browser page requirement** — extraction operations require the browser to already be on the matching page. The runtime finds a page by origin match only; it does not navigate to the operation URL. Callers must navigate the browser first.
- **Lazy-loaded search results** — Amazon lazy-loads search results on scroll. Initial page load may yield fewer results (2–22 depending on timing). Full results require scrolling.
- **`url` field nullable** — search result link extraction is fragile; `h2 a` href is sometimes null. Schema allows `[string, null]`.
- **`helpful` field nullable** — review "helpful vote" count is only present on reviews that have received votes.
- **International reviews** — Amazon sometimes serves reviews from other marketplaces (e.g., Japan). Review language may not match the .com domain.
- **DOM selectors may drift** — Amazon's HTML class names and structure change periodically. Selectors like `.a-price-whole`, `#productTitle` are stable identifiers, but less standard ones may break.
- **Deals page URL varies** — Amazon redirects `/deals` to event-specific URLs (e.g., `/events/bigspringsale`) during promotional periods. Deal card structure (`.dcl-product`) is consistent.
- **Q&A questions only** — The Rufus AI widget provides suggested questions but no pre-loaded answers. Answers require interactive click which is not supported in extraction mode.
- **addToCart not verified** — Write operation, requires browser on product page. Marked `verified: false`.
- **Akamai Bot Manager** — `_abck` cookie and sensor fingerprinting block node transport. Page transport required.
