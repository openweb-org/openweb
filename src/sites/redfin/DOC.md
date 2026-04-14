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
| searchHomes | Search homes by city | regionId, state, city | listings with price, address, sqft | Stingray GIS API; 20 homes per page |
| getPropertyDetails | Full property detail | state, city, address, propertyId ← URL from searchHomes | beds, baths, sqft, price, amenities, photos | JSON-LD from fetched HTML |
| getMarketData | Housing market stats | regionId, state, city | median price, homes sold, days on market | HTML text regex extraction |

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
- **Stingray API** (`/stingray/api/*`) is Redfin's internal API layer. Responses use `{}&&{JSON}` JSONP protection prefix.
- **GIS endpoint** (`/stingray/api/gis`) returns rich search results: MLS ID, price, beds, baths, sqft, lot size, year built, lat/long, photos, days on market.
- **Property detail APIs** (`belowTheFold`, `aboveTheFold`) are CloudFront WAF-blocked. Only `avm` and `descriptiveParagraph` are accessible.
- **JSON-LD structured data** in property page HTML provides the most complete property details.
- **No market data API** exists — housing market stats are SSR-rendered text only.

## Auth
No auth required. All operations use public listing data.

## Transport
- **`node` transport** with `nodeFetch` — all operations use direct Node.js HTTP fetch. No browser needed.
- **searchHomes**: Stingray GIS API (`/stingray/api/gis`) → JSON with JSONP prefix strip.
- **getPropertyDetails**: HTML fetch → JSON-LD `RealEstateListing` extraction.
- **getMarketData**: HTML fetch → regex text extraction from server-rendered content.
- Upgraded from `page` (pageFetch/Tier 5) → `node` (nodeFetch/Tier 7). No bot detection blocks node requests.

## Known Issues
- **No bot detection** observed on API or HTML page requests. All data accessible from Node.js.
- **Region IDs**: Must know the Redfin region ID for search (e.g., Seattle = 16163, San Francisco = 17151). Not discoverable via API.
- **Market data fragility**: Regex text extraction depends on Redfin's text formatting. Price displayed as "$850K" not "$850,000".
