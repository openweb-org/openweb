# eBay — Transport Probe & Robustness Upgrade

## Final Architecture

- **Reads**: DOM extraction (search, seller) + LD+JSON (item detail) — page transport required
- **No transport upgrade possible**: eBay has no internal JSON APIs for search/item/seller data
- **Node fetch blocked**: Radware bot detection returns "Pardon Our Interruption..." for all non-browser requests
- **3 operations** (all read): searchItems, getItemDetail, getSellerProfile

## Probe Journey

### Phase 1: Network Capture

Captured all XHR/fetch requests across search, item detail, and seller pages. Key findings:

**Search page API-like responses:**
- `/sch/ajax/autocomplete` — search autocomplete (not useful for results)
- `/gh/user_profile?modules=USER_PROFILE` — global header user profile
- `/gh/useracquisition` — sign-in prompts
- `/rtm?RtmCmd` — real-time marketing (ads)
- `/ifh/inflowcomponent` — inflow component

**Item page API-like responses:**
- `/nap/napkinapi/v1/ticketing/redeem?ticket=...` — internal ticketing (4 calls per page, `text/plain` responses)
- `/blueberry/v1/ads/identity/pixelUrls` — ad pixel URLs (204)
- `/gh/dfpsvc?v=2` — DFP ad service (204)
- `svcs.ebay.com/ufeservice/v1/metrics` — telemetry

**Seller page API-like responses:**
- `/srv/app/v2/plugin/survey/a/stores.feedback?callback=jsonp_callback_...` — JSONP survey data (not profile data)

**No JSON API exists** for search results, item details, or seller profiles. All data is server-rendered HTML.

### Phase 2: Fetch & Webpack Analysis

**Fetch interceptor**: `window.fetch.toString().length = 173` (native ~30). Patched by Radware StormCaster (`radware_stormcaster_v24.js`) for bot detection — NOT for signing. The interceptor blocks requests to unknown API endpoints with `TypeError: Failed to fetch`.

**Webpack**: None. `webpackChunk` and `__LOADABLE_LOADED_CHUNKS__` both undefined. eBay uses Marko.js (their own framework), not a webpack-based SPA.

**Globals scanned**: `__core-js_shared__` (5 keys) — no useful data globals. No `__NEXT_DATA__`, `__INITIAL_STATE__`, or similar SSR hydration data.

### Phase 3: window.SRP & ___srp Investigation

**`window.SRP`** exists on search page but contains only:
- `metrics` — monitoring counters (imageLoadError, watchListError, etc.)
- `token` — string
- `ATF_IMGS` — number
- `RTM_MANAGER` — ad loading function
- `CUSTOM_METRICS` — timing data

No item data whatsoever.

**`___srp.tl`** — 80 keys (listing IDs as strings), but values are tracking objects: `{trackableId, parentrq, pageci, interaction}`. Event telemetry, not item data.

**`___srp.aspectPicker`** — has `csrfToken` + `localizedContent`. Not useful for reads.

### Phase 4: Node Fetch Test

Tested direct `fetch()` from Node.js (no browser) for all 3 page types:

| Page | Status | Result |
|------|--------|--------|
| Item `/itm/236736961938` | 200 | "Pardon Our Interruption..." (13KB) |
| Search `/sch/i.html?_nkw=laptop` | 200 | Empty HTML, 0 `.s-card` elements |
| Seller `/str/freegeekportland` | 200 | "Please verify" captcha page |

**All blocked by bot detection.** Node transport is not possible.

### Phase 5: LD+JSON Assessment

Item pages have comprehensive `@type: Product` LD+JSON:
```json
{
  "@type": "Product",
  "name": "...",
  "image": ["url1", "url2", ...],
  "offers": {
    "price": "110.0",
    "priceCurrency": "USD",
    "itemCondition": "https://schema.org/UsedCondition",
    "availability": "https://schema.org/InStock",
    "shippingDetails": [{ "shippingRate": { "value": "21.25", "currency": "USD" } }],
    "hasMerchantReturnPolicy": [{ "merchantReturnDays": 30 }]
  },
  "brand": { "name": "Dell" },
  "model": "Dell Latitude 3590"
}
```

This is the most stable extraction source — schema.org standardized, unlikely to change format. Already used as primary extraction by the adapter.

### Phase 6: Decision

```
eBay architecture:
  Server-rendered Marko.js HTML          ← no client-side data APIs
  Radware StormCaster bot detection      ← node fetch blocked
  No webpack modules                     ← no module walk possible
  LD+JSON on item pages only             ← already used
  DOM extraction on search/seller pages  ← no alternative

Verdict: CANNOT UPGRADE TRANSPORT
  - No internal API path exists
  - No structured data alternative for search/seller
  - LD+JSON for items is already the best approach
  - Page transport is required due to bot detection
```

## Changes Made (Robustness Improvements)

Although transport cannot be upgraded, the adapter was improved:

### 1. Fixed broken image extraction in searchItems
**Before**: `.s-card__image img` — selector doesn't match (class is `.su-image`, not `.s-card__image`). Images were always empty.
**After**: `card.querySelector('img')` — matches the first `<img>` in the card. Images now return 85/85.

### 2. Added `data-listingid` for itemId extraction
**Before**: Relied solely on regex parsing `/itm/(\d+)` from href.
**After**: Uses `data-listingid` attribute (HTML5 data attribute, more stable than URL patterns) with href fallback. Sponsored items still filtered by checking href for `/itm/123456`.

### 3. Extracted shipping/returns from LD+JSON
**Before**: Always fell through to DOM selectors for shipping and returns, even when LD+JSON was successfully parsed.
**After**: Extracts `shippingDetails.shippingRate` and `hasMerchantReturnPolicy.merchantReturnDays` from LD+JSON. DOM is fallback only.

### 4. Added brand/model from LD+JSON
New fields `brand` and `model` extracted from LD+JSON Product data when available.

### 5. Parameterized page.evaluate calls
**Before**: String interpolation (`${itemId}`, `${username}`) inside `page.evaluate` template literals.
**After**: `page.evaluate(fn, arg)` — passes values as proper function arguments, eliminating potential injection risk.

### 6. Normalized whitespace in seller card text
**Before**: `card.textContent?.trim()` — Marko.js renders runs text together ("99.8% positive feedback59K items sold").
**After**: `.replace(/\s+/g, ' ').trim()` — normalizes whitespace for more reliable regex matching.

## Verification

**Result: 3/3 PASS** (2026-04-11)

| Operation | Status | Data Quality |
|-----------|--------|-------------|
| searchItems | PASS | 85 items, all with images, 0 sponsored leaks |
| getItemDetail | PASS | LD+JSON primary, brand/model/shipping/returns extracted |
| getSellerProfile | PASS | 99.8% feedback, 59K items sold, 6 categories |

## Why eBay Can't Be Upgraded

eBay is fundamentally a **server-rendered marketplace** (Marko.js) with no client-side APIs:

1. **No search API**: Search results are rendered server-side. No XHR/fetch calls load item data. Pagination is full page navigation (`_pgn=2`), not AJAX.

2. **No item API**: Item detail is rendered server-side with LD+JSON for SEO. The only API calls on item pages are ticketing (`napkinapi`), ads (`blueberry`, `rtm`), and telemetry.

3. **No seller API**: Seller pages are pure HTML. The only API call is a JSONP survey widget.

4. **Heavy bot detection**: Radware StormCaster intercepts all fetch calls, blocks unknown API endpoints, and returns captcha pages for non-browser HTTP clients. This eliminates node transport.

5. **No webpack/SPA architecture**: eBay doesn't use webpack module bundling. There's no module walk path.

The site sits at the **DOM parsing** level on the stability ladder and cannot move lower. The LD+JSON on item pages is the one bright spot — it's standardized schema.org data that's unlikely to break.
