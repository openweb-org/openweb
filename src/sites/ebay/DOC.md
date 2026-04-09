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
| searchItems | search listings by keyword | keywords | itemId, title, price, condition | entry point, paginated |
| getItemDetail | full item details | itemId <- searchItems | title, price, condition, seller, shipping, images | LD+JSON Product schema |
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
- No public JSON APIs — all data extracted from DOM
- Item detail pages have LD+JSON `@type: Product` schema (structured price, condition, images)
- Search results use `.s-card` component classes
- Store pages at `/str/{storeName}` use `.str-seller-card` classes

### Auth
No auth required for public read operations.

### Transport
- `page` transport with adapter — heavy bot detection blocks direct HTTP
- Adapter: `adapters/ebay.ts`
- All operations navigate to real eBay pages and extract data from DOM/LD+JSON

### Extraction
- **Search**: DOM extraction from `.s-card` elements (title, price, condition, itemId from link)
- **Item detail**: LD+JSON `@type: Product` with DOM fallback for seller info
- **Seller profile**: DOM extraction from `.str-seller-card` on store page

### Known Issues
- Heavy bot detection (Cloudflare, Akamai, PerimeterX, DataDome) — requires real browser with page transport
- Search result images often empty due to lazy loading
- Promoted/sponsored results (itemId "123456") are filtered out
- Item pages vary between auction and buy-it-now layouts
- Seller profile requires store slug (from `/str/` URL), not display name
