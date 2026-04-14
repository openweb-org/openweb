# eBay

## Overview
eBay — world's largest auction and marketplace platform. E-commerce archetype.

## Workflows

### Search and view item
1. `searchItems(keywords)` -> results with `itemId`
2. `getItemDetail(itemId)` -> full item info (title, price, bids, condition, shipping)

### Research a seller
1. `searchItems(keywords)` -> results with seller info
2. `getItemDetail(itemId)` -> seller card with `storeSlug`
3. `getSellerProfile(username)` -> feedback score, items sold, followers

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchItems | search listings by keyword | keywords | itemId, title, price, condition, image | entry point, paginated |
| getItemDetail | full item details | itemId <- searchItems | title, price, condition, seller, shipping, returns, brand, model, images | LD+JSON Product schema |
| getSellerProfile | seller reputation | username <- getItemDetail.seller.storeSlug | storeName, positiveFeedback, itemsSold, followers | uses /str/ URL |

## Quick Start

```bash
# Search for items
openweb ebay exec searchItems '{"keywords": "vintage watch"}'

# Get item details (use itemId from search results)
openweb ebay exec getItemDetail '{"itemId": "358422352053"}'

# Get seller profile (use storeSlug from item detail)
openweb ebay exec getSellerProfile '{"username": "freegeekportland"}'
```

---

## Site Internals

### API Architecture
- No internal JSON APIs — eBay is fully server-rendered (Marko.js)
- Item detail pages have LD+JSON `@type: Product` schema (structured price, condition, images, shipping, returns, brand, model)
- Search results use `.s-card` elements with `data-listingid` attribute
- Store pages at `/str/{storeName}` use `.str-seller-card` classes

### Auth
No auth required for public read operations.

### Transport
- `page` transport with adapter — bot detection blocks non-browser requests after rate threshold
- Adapter: `adapters/ebay.ts`
- getItemDetail uses LD+JSON as primary extraction (Tier 3) with DOM fallback
- searchItems and getSellerProfile use DOM extraction (Tier 2)
- Node transport NOT viable — see Transport Upgrade Probe below

### Extraction
- **Search**: DOM extraction from `.s-card` elements; `data-listingid` for item ID, `.s-card__title`/`.s-card__price`/`.s-card__subtitle` for data
- **Item detail**: LD+JSON `@type: Product` (primary) — extracts price, condition, availability, images, shipping, returns, brand, model. DOM fallback for seller card info only.
- **Seller profile**: DOM extraction from `.str-seller-card`; regex parsing of feedback text for stats

### Known Issues
- Heavy bot detection (Radware StormCaster) — requires real browser with page transport
- Promoted/sponsored results (href contains `/itm/123456`) are filtered out
- Item pages vary between auction and buy-it-now layouts
- Seller profile requires store slug (from `/str/` URL), not display name
- Seller store pages intermittently trigger hCaptcha even in real browser sessions
- Seller stats (feedback %, items sold, followers) are JS-loaded, not in SSR HTML

---

## Internal: Transport Upgrade Probe (2026-04-14)

### Probe Results

| Family | Evidence | Node feasible? | page.evaluate(fetch)? | Tier | Verdict |
|--------|----------|----------------|----------------------|------|---------|
| searchItems | SSR HTML with `.s-card` elements, `data-listingid` attrs, no LD+JSON, no API calls | Initial requests pass (200 with data), blocks after ~5 rapid requests | Blocked without cookies from prior navigation | Tier 2 (DOM) | No upgrade |
| getItemDetail | SSR HTML with LD+JSON `@type: Product` (name, image, offers, brand) | Initial requests pass (200 with LD+JSON), blocks after rate threshold | Blocked without cookies | Tier 3 (LD+JSON) | No upgrade |
| getSellerProfile | SSR HTML has store card structure but NO stats (feedback %, items sold, followers) — stats JS-loaded | HTML returned but missing stats data | N/A — stats require JS execution | Tier 2 (DOM) | No upgrade |

### Key Findings

1. **Node direct works initially** — first 3-4 node fetch requests return 200 with full data (search cards, LD+JSON). Bot detection kicks in after ~5-6 rapid requests, returning "Pardon Our Interruption..." captcha page.
2. **page.evaluate(fetch) fails from fresh context** — without prior navigation to establish eBay cookies, fetch calls within browser context are also blocked by Radware.
3. **No internal JSON APIs** — eBay is fully SSR (Marko.js). Network interception shows zero API/XHR calls during page load. All data is server-rendered HTML.
4. **Seller stats are JS-loaded** — store page SSR HTML contains card structure and store name but not feedback/sold/followers stats. These are populated by client-side JavaScript after page load.
5. **Store pages intermittently trigger hCaptcha** — even real browser navigation to `/str/` pages can hit captcha intermittently.
6. **eBay uses unquoted HTML attributes** — `<script type=application/ld+json>` instead of `<script type="application/ld+json">`, `data-listingid=123` instead of `data-listingid="123"`. Relevant for any future HTML parsing.
7. **`window.SRP`** global exists on search pages but contains tracking data, not listing data.

### Conclusion

Transport upgrade is **not viable** for eBay. The combination of:
- Radware StormCaster bot detection (rate-based IP blocking for node requests)
- Missing cookies preventing page.evaluate(fetch) bypass
- No internal JSON APIs (pure SSR)
- JS-loaded seller stats

...means the current Tier 2-3 page transport with DOM/LD+JSON extraction is the optimal approach. getItemDetail already achieves Tier 3 via LD+JSON parsing.
