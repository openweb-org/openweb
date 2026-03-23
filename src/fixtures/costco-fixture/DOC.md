# Costco

## Overview
Costco Wholesale — e-commerce warehouse club. Product search and detail via POST-based APIs.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | POST `gdx-api.costco.com/catalog/search/api/v1/search` | returns title, brands, categories, image, pills, marketing statement |
| getProductDetail | get product by item number | POST `ecom-api.costco.com/ebusiness/product/v1/products/graphql` | returns price, description, attributes, rating |

## API Architecture
- **Hybrid**: POST-based REST search API + GraphQL product detail API
- **Search domain**: `gdx-api.costco.com` — JSON POST body with `query`, `pageSize`, `offset`, warehouse/delivery config
- **Product domain**: `ecom-api.costco.com` — inline GraphQL query (not persisted hashes), products resolved by `itemNumbers`
- Both APIs are cross-origin from `www.costco.com` with CORS enabled
- Search returns product IDs but **no prices** — prices come from the product GraphQL or a separate display-price-lite endpoint
- Some products have `price: 0` meaning "see price in cart" (`disp_price_in_cart_only` attribute)

### Required Headers
| Header | Search | Product | Value |
|--------|--------|---------|-------|
| `client-identifier` | yes | yes | `168287ea-...` (search), `4900eb1f-...` (product) |
| `client_id` | yes | no | `USBC` |
| `locale` | yes | no | `en-US` |
| `searchresultprovider` | yes | no | `GRS` |
| `costco.env` | no | yes | `ecom` |
| `costco.service` | no | yes | `restProduct` |

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
- **No auth required** for public product data
- No cookies, no authorization headers
- Only custom `client-identifier` headers (app-level, not session-level)

## Transport
- **page** transport with `page.request.fetch()` — NOT `page.evaluate(fetch(...))`
- Must have browser on `costco.com` for the adapter to initialize
- `page.request.fetch()` bypasses PerimeterX's client-side fetch interception while inheriting browser cookies

## Extraction
- Direct JSON responses — no SSR extraction needed
- Search: `resp.searchResult.results[]` → product titles, brands, categories in nested `product.attributes` map
- Product: `resp.data.products.catalogData[]` → price, description, attributes array
- Product attributes are `{key, value, type}` arrays — adapter collapses to `Record<string, string[]>`
- `fieldData.mfName` can contain garbage ("DO NOT DELETE") — prefer `attributes.Brand` for brand name
- Rating comes as string from API — adapter converts to number

## Known Issues
- **PerimeterX**: present on `www.costco.com`, intercepts `window.fetch` and `XMLHttpRequest` in `page.evaluate`. Both fail with `TypeError: Failed to fetch`. Workaround: `page.request.fetch()`.
- **Compiler limitation**: both APIs are POST with request bodies → compiler auto-skips them. Manual fixture + L3 adapter required.
- **Price $0**: some items return `price: "0.00000"` — these are "display price in cart only" items, not actually free
- **`_next/static/` without `__NEXT_DATA__`**: Costco serves Next.js-style static chunks but has no `__NEXT_DATA__` script tag. Not a classic Next.js SSR site — hybrid architecture.
- **Shared CDP browser**: when multiple agents share the same CDP browser (localhost:9222), capture sessions can conflict. Other agents may navigate the tab or create new tabs during capture.
