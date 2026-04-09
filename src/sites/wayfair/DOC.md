# Wayfair

## Overview
Home furnishing e-commerce. wayfair.com -- product search, details, reviews via DOM extraction in the browser. PerimeterX bot protection blocks all direct HTTP and in-page fetch; all data extracted from SSR-rendered DOM.

## Workflows

### Search and view products
1. `searchProducts(keyword)` -> browse results -> `sku`
2. `getProductDetail(sku)` -> full product info (name, brand, price, specs, images)

### Research product reviews
1. `searchProducts(keyword)` -> `sku`
2. `getReviews(sku)` -> customer reviews, ratings, verified buyer status

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | sku, name, currentPrice, rating, reviewCount, image | uses on-page search bar |
| getProductDetail | full product page | sku <- searchProducts | name, brand, currentPrice, rating, images, specifications | navigates to PDP |
| getReviews | customer reviews | sku <- searchProducts | overallRating, totalReviews, reviews (rating, text, author, date) | scrolls to review section |

## Quick Start

```bash
# Search for products
openweb wayfair exec searchProducts '{"keyword": "sofa"}'

# Get product details by SKU
openweb wayfair exec getProductDetail '{"sku": "w112838717"}'

# Get customer reviews
openweb wayfair exec getReviews '{"sku": "w112838717"}'
```

---

## Site Internals

### API Architecture
- **No usable API endpoints** -- all internal APIs are behind PerimeterX + DataDome; `page.evaluate(fetch(...))` is blocked
- All product data is SSR-rendered in the HTML DOM
- Adapter navigates to real pages and extracts data from DOM elements

### Auth
- No auth required for public product data
- `requires_auth: false`

### Transport
- **All operations: page** -- adapter runs inside managed browser
- Navigation uses `window.location.href` from within `page.evaluate()` to avoid Playwright goto fingerprint detection by PerimeterX
- searchProducts uses the on-page search bar (type + Enter) rather than URL-based search

### Extraction
- **searchProducts**: Finds the search bar on the current page, types keyword, presses Enter. Extracts product cards from `a[href*="/pdp/"]` links -- walks up DOM to find card container, parses name from image alt / text / URL slug, price from `$` patterns, rating from "Rated X out of 5"
- **getProductDetail**: Navigates to `/furniture/pdp/-{sku}.html`. Extracts name from h1, brand from Manufacturer th/td or page title, price from body text `$X.XX` patterns, images from `img[src*="wfcdn"]`, specs from th/td pairs
- **getReviews**: Navigates to product page, scrolls to reviews section. Parses review blocks split on "Rated N out of 5 stars." -- extracts author, location, verified status, text, date

### Known Issues
- **PerimeterX blocks page.goto()** -- Playwright's `page.goto()` is fingerprinted by PerimeterX as automation. All navigation uses `window.location.href` assignment from within page.evaluate() instead, which appears as user-initiated navigation.
- **Requires wayfair.com tab** -- the managed browser must have a wayfair.com page open (or the adapter creates one). If PerimeterX blocks the initial page, solve the CAPTCHA in the headed browser first.
- **Product name fallback** -- some search result cards show "Wayfair Verified" badge text instead of the product name. The adapter attempts alt text, text elements, then URL slug extraction as fallbacks.
- **Dynamic content** -- prices, ratings, and availability change frequently. Schema validates but results differ between runs.
