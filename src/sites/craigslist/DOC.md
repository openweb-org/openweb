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
- Craigslist serves identical HTML to Node.js and browsers — no bot detection, no JS required.
- City is a subdomain parameter (sfbay, newyork, losangeles, etc.), not a path.

## Auth
No auth required. All operations are public read.

## Transport
- **`node` transport** — all operations use direct HTTP fetch + regex HTML parsing. Zero browser dependency.
- City subdomains: sfbay, newyork, losangeles, chicago, seattle, boston, washingtondc, etc.

## Extraction
- **searchListings**: Regex parsing of `.cl-search-result` / `.result-row` HTML patterns — extracts title, price, URL, postId.
- **getListing**: Regex extraction of title, price, body, images, attributes, coordinates from raw HTML.
- **getCategories**: Regex parsing of category links (`/search/{code}`) from homepage HTML.

## Known Issues
- City subdomains must be known in advance (sfbay, newyork, etc.) — no discovery API.
- Listing URLs include a slug that may change; the numeric post ID is the stable identifier.
- Regex-based parsing depends on Craigslist HTML structure — major redesigns may require adapter updates.
