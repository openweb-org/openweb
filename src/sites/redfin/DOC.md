# Redfin

## Overview
Real estate marketplace — search homes for sale, view property details, and check housing market data.

## Workflows

### Search and explore properties
1. `searchHomes(regionId, state, city)` → listings with price, address, sqft, URL
2. Pick a listing → extract `state`, `city`, `address`, `propertyId` from URL
3. `getPropertyDetails(state, city, address, propertyId)` → full details

### Check market conditions
1. `getMarketData(regionId, state, city)` → median price, homes sold, days on market, competitiveness

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHomes | Search homes by city | regionId, state, city | listings with price, address, sqft | Entry point; ~40 listings per page |
| getPropertyDetails | Full property detail | state, city, address, propertyId ← URL from searchHomes | beds, baths, sqft, price, amenities, photos | JSON-LD extraction |
| getMarketData | Housing market stats | regionId, state, city | median price, homes sold, days on market | Housing market page |

## Quick Start

```bash
# Search homes in Seattle
openweb redfin exec searchHomes '{"regionId":"16163","state":"WA","city":"Seattle"}'

# Get property details (use URL parts from search results)
openweb redfin exec getPropertyDetails '{"state":"WA","city":"Seattle","address":"1546-Sturgus-Ave-S-98144","propertyId":"22392812"}'

# Get Seattle housing market data
openweb redfin exec getMarketData '{"regionId":"16163","state":"WA","city":"Seattle"}'
```

---

## Site Internals

## API Architecture
- **Fully SSR-rendered** — all data baked into initial HTML, not fetched via XHR/fetch.
- Internal `/stingray/api/*` endpoints exist but are minor supporting utilities only.
- **JSON-LD structured data** (`<script type="application/ld+json">`) is the primary extraction source for search and property details.
- Housing market pages use text content from the rendered DOM.

## Auth
No auth required. All operations use public listing data.

## Transport
- **`page` transport** — all data comes from rendered pages via DOM extraction.
- Requires an open `www.redfin.com` page.

## Known Issues
- **No bot detection** — headless Chrome works without issues.
- **DOM-dependent**: JSON-LD uses standard schema.org types (more stable than CSS selectors), but market data parsing depends on Redfin's text formatting.
- **Region IDs**: Must know the Redfin region ID for search (e.g., Seattle = 16163, San Francisco = 17151). Not discoverable via API.
