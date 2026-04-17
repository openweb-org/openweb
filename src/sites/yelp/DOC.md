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

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- `autocompleteBusinesses` hits a JSON API at `/search_suggest/v2/prefetch` — works via direct HTTP (node transport)
- `searchBusinesses` loads the search results page; data is extracted via spec-driven `page_global_data` — dual extraction from SSR JSON (`<script type="application/json">`) with DOM fallback (`[data-testid="serp-ia-card"]`)
- Search results include both organic results and ads (marked with `isAd: true`)

### Auth
No auth required. All operations are public read.

### Transport
- `autocompleteBusinesses`: node (direct HTTP) — `/search_suggest/v2/prefetch` not DataDome-protected
- `searchBusinesses`: page (browser) with `x-openweb.extraction.page_global_data` — all search endpoints DataDome-protected

### Extraction
- **searchBusinesses**: `page_global_data` expression embedded in `openapi.yaml` parses large `<script type="application/json">` SSR blocks, merged with DOM fallback from `[data-testid="serp-ia-card"]` elements. Ad results detected via redirect URLs and handled within the expression.

### Adapter Patterns
Adapter removed in Phase 3 (normalize-adapter); searchBusinesses now uses the `page_global_data` extraction primitive.

### Bot Detection
- **DataDome** — aggressive single-layer detection on all HTML pages and search-related API endpoints
- Blocks automated browsers (Patchright/Playwright) completely — serves CAPTCHA iframe via `geo.captcha-delivery.com`
- Blocks node HTTP for `/search` (403), `/search/snippet` (403)
- Does NOT block the autocomplete API at `/search_suggest/v2/prefetch`
- `datadome` cookie is the only cookie set; no other bot-detection layers detected
- `fetch` is not monkey-patched (native, 34 chars) — signing is not a factor

### Transport Upgrade Investigation (2026-04-14)
Probed for node-viable search endpoints:

| Endpoint | Method | Status | Result |
|----------|--------|--------|--------|
| `/search_suggest/v2/prefetch` | GET | 200 | Works — autocomplete JSON, no DataDome |
| `/search/snippet` | GET | 403 | DataDome blocked (exists, returns JSON block response) |
| `/search` | GET | 403 | DataDome blocked (HTML page) |
| `/gql/batch` | POST | 403 | Forbidden (no GraphQL endpoint found) |
| `/search.json` | GET | 404 | Does not exist |
| `/search/businesses` | GET | 404 | Does not exist |
| `/search_results/inline` | GET | 404 | Does not exist |
| `api.yelp.com/v3/businesses/search` | GET | 400 | Yelp Fusion API — requires OAuth Authorization |

**Conclusion:** Transport upgrade not viable. DataDome blocks all search-related endpoints from both node and automated browsers. Only the autocomplete API bypasses DataDome. The Yelp Fusion API (v3) exists but requires OAuth credentials, which is out of scope.

### Known Issues
- **searchBusinesses currently broken** — DataDome blocks automated browsers (Patchright) from loading any Yelp page. Page extraction receives a 1591-byte challenge page instead of search results. This is a DataDome policy change since the extraction was last verified (2026-04-06).
- `autocompleteBusinesses` continues to work on node transport (not DataDome-protected)
- SSR JSON structure may change across Yelp deployments; DOM fallback in the extraction expression provides resilience
- Ad results use redirect URLs; the extraction expression resolves these to extract the actual business alias
