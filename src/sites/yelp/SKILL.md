# Yelp

## Overview
Local business discovery platform — search businesses, autocomplete suggestions, read reviews. Commerce archetype.

## Workflows

### Search for local businesses
1. `autocompleteBusinesses(prefix, loc)` → suggestions with `query`
2. `searchBusinesses(find_desc, find_loc)` → business list with `name`, `rating`, `address`

### Browse by location
1. `searchBusinesses(find_desc, find_loc)` → results with `bizId`, `alias`, `categories`
2. Paginate with `start` param (10 results per page)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| autocompleteBusinesses | typeahead suggestions | prefix, loc | title, query, subtitle, type | entry point; node transport |
| searchBusinesses | search businesses by keyword + location | find_desc, find_loc | name, rating, reviewCount, categories, address | entry point; adapter (browser); paginated (start) |

## Quick Start

```bash
# Autocomplete suggestions
openweb yelp exec autocompleteBusinesses '{"prefix": "piz", "loc": "San Francisco, CA"}'

# Search for businesses
openweb yelp exec searchBusinesses '{"find_desc": "pizza", "find_loc": "San Francisco, CA"}'

# Paginate search results (page 2)
openweb yelp exec searchBusinesses '{"find_desc": "pizza", "find_loc": "San Francisco, CA", "start": 10}'
```
