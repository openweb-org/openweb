# DoorDash

## Overview
Food delivery marketplace. Archetype: Food Delivery / Marketplace.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchRestaurants | search restaurants by keyword | POST /graphql/autocompleteFacetFeed | returns name, categories, image, storeId; includes grocery item suggestions (null categories) |
| getRestaurantMenu | get store detail + full menu | POST /graphql/storepageFeed | storeHeader (name, rating, address, delivery time), menuBook (categories), itemLists (items with name/price/description/image) |
| getOrderHistory | get past orders with details | POST /graphql/getConsumerOrdersWithDetails | order items, totals, store info, timestamps; requires auth |
| addToCart | add menu item to cart | POST /graphql/addCartItem | mutation addCartItemV2; requires storeId + itemId from getRestaurantMenu; returns cartId, subtotal, items; NEVER checkout |

## API Architecture
- **GraphQL** — all API traffic is POST with JSON body `{ operationName, variables, query }`
- Gateway URL pattern: `https://www.doordash.com/graphql/<operationName>?operation=<operationName>`
- Full query strings sent per-request (no persisted query hashes) — simplified queries work
- Responses can be very large: storepageFeed ~230KB, getConsumerOrdersWithDetails ~86KB
- Search (`autocompleteFacetFeed`) returns a `FacetFeedV2` structure: nested `body[].body[]` items with `text.title`, `text.description`, `images.main.uri`, `custom` (JSON string with `store_id`)
- Store menu (`storepageFeed`) takes `storeId` (required) and optional `menuId`, `fulfillmentType`
- Order history (`getConsumerOrdersWithDetails`) takes `offset`/`limit` pagination

## Auth
- **cookie_session** — user must be logged in via managed browser
- Auth cookies: `dd_session_id`, `ddweb_token`
- Additional cookies: `csrf_token`, `dd_cx_logged_in`, `authState`
- No CSRF header injection needed for read operations (GraphQL POST works with just cookies)
- Write operations (addToCart) also work with cookies only — no additional CSRF token required

## Transport
- **page** (L3 adapter) — adapter uses `page.evaluate(fetch(..., { credentials: 'include' }))` to leverage browser cookies
- Any DoorDash page must be open (`doordash.com/*`)
- Could theoretically work with `node` transport + extracted cookies, but the cookie set is complex (Cloudflare, WAF tokens)

## Extraction
- Direct JSON from GraphQL responses
- Adapter normalizes search results: extracts restaurant info from nested FacetV2 structure, parses `custom` JSON string for `store_id`
- Menu and order data returned as-is from GraphQL (already structured)

## Known Issues
- No bot detection observed (Cloudflare challenge not triggered for authenticated sessions)
- `formattedAddress` in order history is often null — schema allows nullable
- Search results include non-store items (grocery product suggestions) — `resultType` field distinguishes them
- GraphQL queries are minified single-line strings from the frontend; simplified multi-line queries work identically
- Compiler cannot auto-compile this site (all POST with body → auto-skipped) — requires manual L3 adapter
