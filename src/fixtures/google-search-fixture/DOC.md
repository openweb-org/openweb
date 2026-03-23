# Google Search

## Overview
Search engine. Google.com — autocomplete suggestions, organic web search results, and image search results via a mix of node transport and page DOM extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchSuggestions | autocomplete for query prefix | GET /complete/search?q={q}&client=chrome | node transport, returns JSON array of suggestions |
| searchWeb | organic web results | GET /search?q={q} | page extraction, returns title, link, displayUrl, snippet |
| searchImages | image results | GET /search?q={q}&udm=2 | page extraction, returns sourceUrl, alt, width, height |

## API Architecture
- **Hybrid** — suggestions use a public JSON endpoint; web and image search use page-level DOM extraction
- Suggestions endpoint (`/complete/search`) returns JSONP-style array when `client=chrome`: `["prefix", ["suggestion1", "suggestion2", ...]]`
- Web/image search have no usable public API — all data is in the rendered DOM
- Image search is accessed via the same `/search` path with `udm=2` parameter

## Auth
- `requires_auth: false`
- **searchSuggestions**: no auth — public endpoint, works with bare GET requests
- **searchWeb / searchImages**: no auth tokens, but requires a page transport (browser context) to render the DOM for extraction

## Transport
- **searchSuggestions**: `transport: node` — direct HTTP fetch, returns clean JSON
- **searchWeb / searchImages**: `transport: page` (server default) — requires an open Google search page in the managed browser to run extraction expressions against the DOM

## Extraction
- **searchSuggestions**: direct JSON response — tuple array `[query, [suggestions...]]`
- **searchWeb**: `page_global_data` — runs JS expression on `/search` page
  - Result containers: `div.tF2Cxc` and `div.Ww4FFb`
  - Title from `h3`, link from `a[href]`, snippet from `.VwiC3b` / `[data-sncf]` / `.lEBKkf`, display URL from `cite`
  - Query read back from `textarea[name=q]` or `input[name=q]`
- **searchImages**: `page_global_data` — runs JS expression on `/search` page (with `udm=2`)
  - Image containers: `[data-lpage]` attribute holds the source page URL
  - Thumbnail dimensions from `img.naturalWidth` / `img.naturalHeight`
  - Query read back the same way as searchWeb

## Known Issues
- **DOM selector fragility** — Google frequently A/B tests result layouts. Selectors like `div.tF2Cxc`, `.VwiC3b`, and `[data-lpage]` are class-based and may drift without notice. Monitor verify fingerprints.
- **Search results cause expected DRIFT** — different results on every call. Schema validation passes; fingerprint hash changes. Normal for dynamic search endpoints.
- **Thumbnail dimensions may be 0** — `naturalWidth`/`naturalHeight` report 0 if images haven't finished loading when the extraction expression runs.
- **Regional/personalization variance** — results vary by IP geo, language, and Google account state in the browser profile.
