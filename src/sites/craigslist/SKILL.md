# Craigslist

## Overview
Classic US classifieds platform — search listings across cities and categories, view listing details, browse category structure. Pure server-rendered HTML, no JS framework.

## Workflows

### Search and view listings
1. `getCategories(city)` → `code`, `name`, `section` per category
2. `searchListings(category, city, query)` → `title`, `price`, `url`, `postId`
3. Parse listing `url` → extract `category`, `slug`, `id`
4. `getListing(category, slug, id, city)` → `title`, `body`, `price`, `location`, `images`, `attributes`

### Quick search
1. `searchListings(category, city, query)` → `title`, `price`, `url`, `postId`
2. Parse `url` → `category`, `slug`, `id` → `getListing` for full details

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchListings | Search listings by category + keyword | category (<- getCategories `code`), city, query | title, price, url, postId | **entry point**; city defaults to sfbay |
| getListing | Full listing detail | category, slug, id (<- searchListings `url` path parts), city | title, body, price, location, images, attributes | |
| getCategories | List category codes | city | name, code, section | **entry point**; homepage category links |

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
