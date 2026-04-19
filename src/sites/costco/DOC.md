# Costco

## Overview
E-commerce warehouse club. Product search, detail, reviews, warehouse locator, delivery options, cart management, and product comparison.

## Workflows

### Find and evaluate a product
1. `searchProducts(query)` → product listings with `itemNumber`
2. `getProductDetail(itemNumber)` → price, description, attributes, rating
3. `getProductReviews(productId)` → review summary, rating distribution, recommendation %

### Compare products before buying
1. `searchProducts(query)` → find candidates → `itemNumber`s
2. `compareProducts(itemNumbers)` → side-by-side price, brand, rating, attributes
3. `getDeliveryOptions(itemNumber)` → shipping/pickup availability per product

### Check warehouse availability
1. `findWarehouses(latitude, longitude)` → nearby warehouses with `warehouseId`
2. `getWarehouseDetails(warehouseId)` → full hours, services, amenities
3. `checkWarehouseStock(itemNumber, warehouseNumber)` → in-store vs online-only, price

### Browse and discover
1. `searchSuggestions(query)` → autocomplete completions to refine search
2. `browseCategory(category)` → products by department with available filters

### Cart management (requires login)
1. `searchProducts(query)` → `itemNumber`
2. `addToCart(itemNumber, quantity)` → `orderItemId`
3. `updateCartQuantity(orderItemId, quantity)` → update quantity
4. `removeFromCart(orderItemId)` → remove item

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search by keyword | query | itemNumber, title, brands, pills | entry point, paginated (pageSize, offset) |
| searchSuggestions | autocomplete | query | term, type | entry point |
| getProductDetail | product details | itemNumber ← searchProducts | price, rating, attributes, buyable | price=0 means "see in cart" |
| getMultipleProducts | batch product lookup | itemNumbers ← searchProducts | price, brand, rating per item | |
| compareProducts | side-by-side comparison | itemNumbers ← searchProducts (2+) | price, brand, rating, attributes | |
| getProductReviews | review summary | productId ← searchProducts | totalReviews, averageRating, distribution | navigates page (BV widget) |
| getDeliveryOptions | shipping/pickup check | itemNumber ← searchProducts | options[].type, available, membershipRequired | types: shipping, business_delivery, warehouse_pickup |
| browseCategory | browse by department | category | products, availableFilters | entry point, paginated |
| findWarehouses | nearby warehouses | latitude, longitude | warehouseId, name, address, hours, services | entry point |
| getWarehouseDetails | full warehouse info | warehouseId ← findWarehouses | hours, services[].name/hours, has* booleans | |
| checkWarehouseStock | in-store availability | itemNumber ← searchProducts, warehouseNumber ← findWarehouses | inWarehouse, onlineOnly, price | |
| addToCart | add to cart | itemNumber ← searchProducts | orderItemId | write, requires login |
| removeFromCart | remove from cart | orderItemId ← addToCart | success | write, requires login. Static `verify --write` blocked on cross-op chain |
| updateCartQuantity | change cart qty | orderItemId ← addToCart, quantity | success | write, requires login. Static `verify --write` blocked on cross-op chain |

## Quick Start

```bash
# Search for products
openweb costco exec searchProducts '{"query": "laptop"}'

# Get product details (use itemNumber from search)
openweb costco exec getProductDetail '{"itemNumber": "100978861"}'

# Get review summary
openweb costco exec getProductReviews '{"productId": "4000373324"}'

# Find nearby warehouses
openweb costco exec findWarehouses '{"latitude": 37.35, "longitude": -121.95, "limit": 3}'

# Check delivery options
openweb costco exec getDeliveryOptions '{"itemNumber": "100978861", "zipCode": "95050"}'

# Browse a category
openweb costco exec browseCategory '{"category": "Electronics"}'

# Compare products side by side
openweb costco exec compareProducts '{"itemNumbers": ["100978861", "4000373324"]}'
```

---

## Site Internals

## API Architecture
- **Hybrid**: POST-based REST search + GraphQL product detail + REST warehouse locator + BazaarVoice reviews
- **Search domain**: `gdx-api.costco.com` — JSON POST body with `query`, `pageSize`, `offset`, warehouse/delivery config
- **Product domain**: `ecom-api.costco.com` — inline GraphQL query (not persisted hashes), products resolved by `itemNumbers`
- **Warehouse domain**: `ecom-api.costco.com/core/warehouse-locator/v1` — GET with lat/lng
- **Reviews**: BazaarVoice widget loads on product pages, data extracted from `BV.rating_summary.apiData` via page.evaluate
- Search returns product IDs but **no prices** — prices come from the product GraphQL
- Some products have `price: 0` meaning "see price in cart" (`disp_price_in_cart_only` attribute)

## Auth
- **No auth required** for all read operations (search, product, reviews, warehouses)
- Each API domain uses a distinct `client-identifier` (app-level, not session-level)
- **Cart operations require login** — browser must have session cookies and JWT auth token

## Transport
- **page** transport with `page.request.fetch()` for read ops (search, product, warehouse, reviews) — bypasses PerimeterX-style client-side fetch interception while inheriting browser cookies
- **Cart write ops use DOM-context fetch (`page.evaluate(fetch())`)**, NOT `page.request.fetch()` — Costco's Akamai Bot Manager returns HTTP 403 for Playwright APIRequestContext even with valid session cookies. DOM fetch carries page origin, sec-fetch-* headers, and runs inside the JS engine that solved the Akamai sensor challenge, so it's allowed through. See Known Issues.
- Each write op declares `page_plan.entry_url` (PDP for add, `/CheckoutCartView` for remove/update) so the runtime pre-navigates and the adapter can scrape page-bound state (JWT/SKU/catalogEntryId) before POST.
- Must have browser on `costco.com` for the adapter to initialize
- **Reviews exception**: uses `page.goto()` + `page.evaluate` to navigate to product page and extract BV widget data from `window.BV` global
- **Warehouse details exception**: uses `page.goto()` to navigate to `costco.com/w/-/{warehouseId}` and extracts JSON-LD `LocalBusiness` structured data
- **Search suggestions**: uses typeahead search (`POST /search?searchType=typeahead`) — the original `/suggest` endpoint is blocked by Apigee X (403)

## Adapter Patterns

### Cart endpoints differ between PDP-add and cart-page edits

| Op | URL | Auth token | Required scraped fields |
|---|---|---|---|
| addToCart | `/AjaxManageShoppingCartCmd?ajaxFlag=true&...` | JWT from sessionStorage `authToken_<userHash>` | SKU from PDP JSON-LD `Product.sku` (different from URL `itemNumber` — `itemNumber` is the parent catalog id, SKU is the variant) |
| removeFromCart | `/AjaxModularManageShoppingCartCmd?checkoutPage=cart` | WCS `userId,signature` from cart-page hidden input `name=authToken` | `orderId`, `catalogEntryId_N` from cart-page hidden inputs (matched to `orderItem_N=<orderItemId>`) |
| updateCartQuantity | `/order-quantity-update?checkoutPage=cart` | WCS authToken (same source as remove) | `orderId`, `catalogEntryId_N` (same as remove) |

The two authToken formats are NOT interchangeable. PDP add demands the B2C JWT; cart edits reject it and demand the WCS short token. Both are present in a logged-in browser but in different surfaces.

### `productBeanId` ≠ `catalogEntryId`
addToCart's response contains `productBeanId` (e.g. `2908797`); the cart page's `catalogEntryId_1` for the same line is `2908798` — off by one. Don't try to derive one from the other; scrape `catalogEntryId_N` from the cart page each time.

## Extraction
- Direct JSON responses for search, product, warehouse — no SSR extraction needed
- Search: `resp.searchResult.results[]` → product titles, brands, categories in nested `product.attributes` map
- Product: `resp.data.products.catalogData[]` → price, description, attributes array
- Product attributes are `{key, value, type}` arrays — adapter collapses to `Record<string, string[]>`
- `fieldData.mfName` can contain garbage ("DO NOT DELETE") — prefer `attributes.Brand` for brand name
- Rating comes as string from API — adapter converts to number
- Warehouse: `resp.salesLocations[]` → localized name/address, nested `hours[]` and `services[]` arrays
- Reviews: `window.BV.rating_summary.apiData[productId]` → summary stats from BazaarVoice internal cache

## Known Issues
- **Akamai Bot Manager blocks `page.request.fetch()` on cart endpoints (HTTP 403).** Cookies and Akamai sensor cookies (`_abck`, `bm_sz`, `ak_bmsc`) are present, but Playwright's APIRequestContext fingerprint is detectable as non-browser. Fix: cart adapter uses `page.evaluate(fetch())` from DOM context. Read endpoints (gdx-api, ecom-api subdomains) are not behind Akamai and continue to use `page.request.fetch()`.
- **PerimeterX**: present on `www.costco.com`, intercepts `window.fetch` and `XMLHttpRequest` in `page.evaluate` for some non-cart paths. Read adapters work around it via `page.request.fetch()`.
- **BazaarVoice auth**: BV BFD API returns 401 from `page.request.fetch()`. Reviews extracted from BV widget's cached state instead.
- **Reviews limited to summary**: full review text not available — only aggregates (count, average, distribution, recommendation %).
- **getProductReviews navigates**: uses `page.goto()` — changes current page URL, may affect subsequent operations.
- **getWarehouseDetails navigates**: uses `page.goto()` to warehouse detail page — same navigation caveat as reviews.
- **Suggest API blocked**: `gdx-api.costco.com/catalog/search/api/v1/suggest` returns 403 from Apigee X gateway. `searchSuggestions` uses the typeahead search endpoint instead, returning product titles as suggestions.
- **Price $0**: some items return `price: 0` — these are "display price in cart only" items, not actually free.
- **Compiler limitation**: search and product APIs are POST with request bodies → compiler auto-skips them. Manual fixture + L3 adapter required.
- **`orderItemId` returned as integer.** addToCart's response gives `orderItemId: <number>`. The OpenAPI param schema for `removeFromCart` / `updateCartQuantity` is `type: [string, integer]` to accept both forms when chained via `${prev.addToCart.orderItemId}` templating.
- **Cart edits are page-bound.** `removeFromCart` / `updateCartQuantity` only work for items currently in the user's live cart on the managed Chrome — they scrape `orderId` and `catalogEntryId_N` from `/CheckoutCartView` each call.

## Probe Results

- **APIRequestContext vs DOM fetch on Akamai endpoints (2026-04-19):** Probed `/AjaxManageShoppingCartCmd` from both `page.request.fetch()` and `page.evaluate(fetch())` with the same cookies, same browser, same params — the former returned 403 from `AkamaiGHost`, the latter returned 200. Cookies including `_abck`, `bm_sz`, `WC_AUTHENTICATION_<userId>`, `JSESSIONID`, `mSign=1` were present in both cases. Confirms the Akamai signal is request fingerprint, not session.
- **Real cart POSTs captured by listening on `page.on('request')` while clicking the cart UI:** PDP add hits `/AjaxManageShoppingCartCmd` with full WCS param set + JWT; cart-page remove hits `/AjaxModularManageShoppingCartCmd?checkoutPage=cart`; cart-page quantity change hits `/order-quantity-update?checkoutPage=cart`. Three different endpoints, two authToken formats.
