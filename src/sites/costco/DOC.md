# Costco

## Overview
Costco Wholesale — e-commerce warehouse club. Product search, detail, reviews, warehouse locator, and cart via POST-based APIs and BazaarVoice.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | POST `gdx-api.costco.com/catalog/search/api/v1/search` | returns title, brands, categories, image, pills, marketing statement |
| getProductDetail | get product by item number | POST `ecom-api.costco.com/ebusiness/product/v1/products/graphql` | returns price, description, attributes, rating |
| getProductReviews | get review summary for a product | page.evaluate + BV internal state | returns total reviews, average rating, distribution, recommendation % |
| findWarehouses | find nearby warehouse locations | GET `ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json` | returns address, hours, services, distance |
| addToCart | ⚠️ add product to cart | POST `www.costco.com/AjaxManageShoppingCartCmd` | requires login, write permission |

## API Architecture
- **Hybrid**: POST-based REST search API + GraphQL product detail API + REST warehouse locator + BazaarVoice reviews
- **Search domain**: `gdx-api.costco.com` — JSON POST body with `query`, `pageSize`, `offset`, warehouse/delivery config
- **Product domain**: `ecom-api.costco.com` — inline GraphQL query (not persisted hashes), products resolved by `itemNumbers`
- **Warehouse domain**: `ecom-api.costco.com/core/warehouse-locator/v1` — GET with lat/lng, different `client-identifier` (`7c71124c-...`)
- **Reviews**: BazaarVoice widget loads on product pages, data extracted from `BV.rating_summary.apiData` via page.evaluate (BV BFD API requires internal auth, inaccessible via page.request)
- **Cart**: POST to `www.costco.com/AjaxManageShoppingCartCmd` with query params, requires browser session cookies + auth token
- All APIs are cross-origin from `www.costco.com` with CORS enabled
- Search returns product IDs but **no prices** — prices come from the product GraphQL
- Some products have `price: 0` meaning "see price in cart" (`disp_price_in_cart_only` attribute)

### Required Headers
| Header | Search | Product | Warehouse | Value |
|--------|--------|---------|-----------|-------|
| `client-identifier` | yes | yes | yes | `168287ea-...` (search), `4900eb1f-...` (product), `7c71124c-...` (warehouse) |
| `client_id` | yes | no | no | `USBC` |
| `locale` | yes | no | no | `en-US` |
| `searchresultprovider` | yes | no | no | `GRS` |
| `costco.env` | no | yes | no | `ecom` |
| `costco.service` | no | yes | no | `restProduct` |

### Search Request Body
```json
{
  "visitorId": "0",
  "query": "laptop",
  "pageSize": 24,
  "offset": 0,
  "searchMode": "page",
  "warehouseId": "249-wh",
  "shipToPostal": "95050",
  "shipToState": "CA",
  "deliveryLocations": ["653-bd", "848-bd", "249-wh", "847_0-wm"]
}
```
`visitorId` and `userInfo` fields are required or the backend returns 500.

## Auth
- **No auth required** for public product data, reviews, and warehouse locator
- No cookies or authorization headers for read operations
- Each API domain uses a distinct `client-identifier` (app-level, not session-level)
- **addToCart requires login** — browser must have session cookies and JWT auth token

## Transport
- **page** transport with `page.request.fetch()` — NOT `page.evaluate(fetch(...))`
- Must have browser on `costco.com` for the adapter to initialize
- `page.request.fetch()` bypasses PerimeterX's client-side fetch interception while inheriting browser cookies
- **Reviews exception**: uses `page.evaluate` + `page.goto` to navigate to product page and extract BV widget data from `window.BV` global (BV BFD API returns 401 via page.request)

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
- **PerimeterX**: present on `www.costco.com`, intercepts `window.fetch` and `XMLHttpRequest` in `page.evaluate`. Both fail with `TypeError: Failed to fetch`. Workaround: `page.request.fetch()`.
- **BazaarVoice auth**: BV BFD API (`apps.bazaarvoice.com/bfd/...`) returns 401 from `page.request.fetch()`. BV's internal `bvFetch` adds auth headers not accessible externally. Reviews extracted from BV widget's cached state instead.
- **Reviews limited to summary**: full review text (title, body, author) not available — only aggregates (count, average, distribution, recommendation %). Individual review text is rendered by BV widget but requires complex DOM scraping.
- **Compiler limitation**: search and product APIs are POST with request bodies → compiler auto-skips them. Manual fixture + L3 adapter required.
- **Price $0**: some items return `price: "0.00000"` — these are "display price in cart only" items, not actually free
- **`_next/static/` without `__NEXT_DATA__`**: Costco serves Next.js-style static chunks but has no `__NEXT_DATA__` script tag. Not a classic Next.js SSR site — hybrid architecture.
- **Shared CDP browser**: when multiple agents share the same CDP browser (localhost:9222), capture sessions can conflict. Other agents may navigate the tab or create new tabs during capture.
- **getProductReviews navigates**: this operation uses `page.goto()` to load the product page for BV data — it changes the current page URL, which may affect subsequent operations that depend on page state.
