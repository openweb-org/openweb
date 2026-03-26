# Target

## Overview
Target.com — major US e-commerce retailer. Product search, detail, and store availability via internal Redsky aggregation APIs.

## Operations
| Operation | Intent | Method | Safety | Notes |
|-----------|--------|--------|--------|-------|
| searchProducts | search products by keyword | GET /redsky_aggregations/v1/web/plp_search_v2 | ✅ read | returns 24 products with title, price, rating, images; HTTP 206 |
| getProductDetail | full product detail by TCIN | GET /redsky_aggregations/v1/web/pdp_client_v1 | ✅ read | description, price, rating distribution, variants, brand |
| getStoreAvailability | per-store stock and pickup times | GET /redsky_aggregations/v1/web/fiats_v1 | ✅ read | stock qty, pickup SLA, curbside, nearby stores by zip |
| addToCart | add product to cart by TCIN | POST /web_checkouts/v1/cart_items | ⚠️ CAUTION | adds item to cart only, NEVER checkout/purchase; returns cart_id, pricing, fulfillment; on carts.target.com |

## API Architecture
- REST JSON APIs on `redsky.target.com` (read aggregation) and `carts.target.com` (cart mutations) — both dedicated subdomains separate from `www.target.com`
- Read endpoints follow the pattern `/redsky_aggregations/v1/web/<aggregation_name>`
- Cart endpoint at `/web_checkouts/v1/cart_items` accepts POST with JSON body `{cart_item: {tcin, quantity}, fulfillment: {type, location_id, ship_method}}`
- Static API key required as `key` query param (embedded in frontend JS): `9f36aeafbe60771e321a7cc95a78140772ab3e96`
- Search returns HTTP 206 (Partial Content), not 200 — the response is paginated and `count`/`offset` control pagination
- Product IDs are called TCINs (Target item IDs), e.g. `92750139`
- Additional APIs exist but are not in the fixture: `product_summary_with_fulfillment_v1` (search card data by TCIN list), `store_location_v1` (store info), `pdp_personalized_v1` (personalized recs)
- The main site also uses `cdui-orchestrations.target.com` for page layout orchestration (search page returns ~340KB layout JSON) — not needed for data extraction

## Auth
- **None required** for Redsky APIs — static API key only
- `visitor_id` param is accepted but optional (any value or omission works)
- `member_id` appears in some requests when logged in but is not required
- Browser cookies (session, PerimeterX) are NOT needed for Redsky API calls

## Transport
- **node** — direct HTTP fetch works for all Redsky aggregation APIs
- PerimeterX bot detection is active on `www.target.com` but **NOT** on the API subdomain `redsky.target.com`
- This is unusual for e-commerce — most sites (Costco, Best Buy) require browser context for API access
- `page` transport was initially attempted but fails because `findPageForOrigin` can't match `redsky.target.com` to a `www.target.com` browser tab (the `redsky` subdomain prefix isn't in the allowed strip list `www|api|oauth`)

## Extraction
- Direct JSON responses — no SSR extraction, no HTML parsing needed
- Response structure: all APIs wrap data in `{ "data": { ... } }`
- Search: `data.search.products[]` array with `tcin`, `item.product_description.title`, `price.formatted_current_price`, `ratings_and_reviews.statistics.rating.average`
- PDP: `data.product` with full detail including `children[]` for variants
- Store availability: `data.fulfillment_fiats.locations[]` with per-store stock and pickup options

## Known Issues
- **Compiler auto-filters all traffic as noise** — manual fixture creation required (same issue as real estate sites)
- **Capture tool tab selection is fragile** — when multiple tabs are open, capture often attaches to the wrong tab. Close all other tabs before starting capture.
- **Search returns 206, not 200** — test assertions must use status 206
- **API key may rotate** — the static key `9f36aeafbe60771e321a7cc95a78140772ab3e96` is embedded in frontend JS and could change with deploys
- **`store_id` and `pricing_store_id` affect pricing** — different stores may show different prices; default `2281` is San Jose Central
