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
- `page` transport with adapter — Radware StormCaster bot detection blocks all non-browser requests
- Adapter: `adapters/ebay.ts`
- Node transport not possible (returns "Pardon Our Interruption..." captcha)

### Extraction
- **Search**: DOM extraction from `.s-card` elements; `data-listingid` for item ID, `.s-card__title`/`.s-card__price`/`.s-card__subtitle` for data
- **Item detail**: LD+JSON `@type: Product` (primary) — extracts price, condition, availability, images, shipping, returns, brand, model. DOM fallback for seller card info only.
- **Seller profile**: DOM extraction from `.str-seller-card`; regex parsing of feedback text for stats

### Known Issues
- Heavy bot detection (Radware StormCaster) — requires real browser with page transport
- Promoted/sponsored results (href contains `/itm/123456`) are filtered out
- Item pages vary between auction and buy-it-now layouts
- Seller profile requires store slug (from `/str/` URL), not display name
