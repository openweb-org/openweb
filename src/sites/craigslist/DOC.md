# Craigslist

## Overview
Classic US classifieds platform — search listings across cities and categories, view listing details, browse category structure. Pure server-rendered HTML, no JS framework.

## Workflows

### Search and view listings
1. `getCategories(city)` -> browse available categories with codes
2. `searchListings(category, city, query)` -> listing titles, prices, URLs
3. Pick a listing -> extract `category`, `slug`, `id` from URL
4. `getListing(category, slug, id, city)` -> full details with body, images, attributes

### Quick search
1. `searchListings(category, city, query)` -> results with `title`, `price`, `url`, `postId`
2. Use `postId` and URL parts to call `getListing` for details

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchListings | Search listings by category + keyword | category, city, query | title, price, url, postId | Entry point; city defaults to sfbay |
| getListing | Full listing detail | category, slug, id, city | title, body, price, location, images, attributes | URL parts from search results |
| getCategories | List category codes | city | name, code, section | Homepage category links |

## Quick Start

```bash
# Search SF apartments
openweb craigslist exec searchListings '{"category": "apa", "city": "sfbay", "query": "2br"}'

# Search NYC jobs
openweb craigslist exec searchListings '{"category": "jjj", "city": "newyork"}'

# Get listing details
openweb craigslist exec getListing '{"category": "apa", "slug": "sunny-2br-mission", "id": "7891234567", "city": "sfbay"}'

# Browse categories
openweb craigslist exec getCategories '{"city": "sfbay"}'
```

### Common Category Codes
- `apa` — apartments/housing for rent
- `roo` — rooms/shared
- `rea` — real estate for sale
- `jjj` — jobs
- `sss` — all for-sale
- `ccc` — community
- `ggg` — gigs
- `bbb` — services offered

---

## Site Internals

## API Architecture
- **Pure server-rendered HTML** — no client-side framework, no JSON APIs.
- All data extracted from the DOM using CSS selectors.
- City is a subdomain parameter (sfbay, newyork, losangeles, etc.), not a path.

## Auth
No auth required. All operations are public read.

## Transport
- **`page` transport** — all operations use browser DOM extraction.
- City subdomains: sfbay, newyork, losangeles, chicago, seattle, boston, washingtondc, etc.

## Extraction
- **searchListings**: Multi-strategy DOM extraction — tries `.cl-search-result`, `.cl-static-search-result`, and legacy `.result-row` selectors for resilience across Craigslist redesigns.
- **getListing**: Title from `.postingtitletext`, price from `.price`, body from `#postingbody`, images from `#thumbs`, attributes from `.attrgroup`, coordinates from `#map` data attributes.
- **getCategories**: Parses category links (`/search/{code}`) from the homepage.

## Known Issues
- City subdomains must be known in advance (sfbay, newyork, etc.) — no discovery API.
- Listing URLs include a slug that may change; the numeric post ID is the stable identifier.
- Craigslist's HTML structure varies slightly across redesign phases; the adapter uses fallback selectors.
