# Google Search

## Overview
Search engine. Google.com — autocomplete suggestions, organic web search, image/news/video/shopping results, and knowledge panel data via a mix of node transport and page DOM extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchSuggestions | autocomplete for query prefix | GET /complete/search?q={q}&client=chrome | node transport, returns JSON array of suggestions |
| searchWeb | organic web results | GET /search?q={q} | page extraction, returns title, link, displayUrl, snippet |
| searchImages | image results | GET /search?q={q}&udm=2 | page extraction, returns sourceUrl, alt, width, height |
| searchNews | news article results | GET /search?q={q}&tbm=nws | page extraction, returns title, link, source, snippet, publishedAt |
| searchVideos | video results | GET /search?q={q}&tbm=vid | page extraction, returns title, link, source, snippet |
| searchShopping | shopping product results | GET /search?q={q}&udm=28 | page extraction, returns title, price, originalPrice, merchant, reviewCount |
| getKnowledgePanel | entity knowledge panel | GET /search?q={q} | page extraction, returns title, subtitle, description, facts array |

## API Architecture
- **Hybrid** — suggestions use a public JSON endpoint; all other operations use page-level DOM extraction
- Suggestions endpoint (`/complete/search`) returns JSONP-style array when `client=chrome`: `["prefix", ["suggestion1", "suggestion2", ...]]`
- Web/image/news/video/shopping/knowledge panel have no usable public API — all data is in the rendered DOM
- Image search: same `/search` path with `udm=2`
- News search: `/search` with `tbm=nws`
- Video search: `/search` with `tbm=vid`
- Shopping search: `/search` with `udm=28` (Google redirects `tbm=shop` to `udm=28`)
- Knowledge panel: appears in sidebar of regular `/search` results for entity queries

## Auth
- `requires_auth: false`
- **searchSuggestions**: no auth — public endpoint, works with bare GET requests
- **All other ops**: no auth tokens, but requires a page transport (browser context) to render the DOM for extraction

## Transport
- **searchSuggestions**: `transport: node` — direct HTTP fetch, returns clean JSON
- **All other ops**: `transport: page` (server default) — requires an open Google search page in the managed browser; each operation type needs navigation to the appropriate search tab URL

## Extraction
- **searchSuggestions**: direct JSON response — tuple array `[query, [suggestions...]]`
- **searchWeb**: `page_global_data` — runs JS expression on `/search` page
  - Result containers: `div.tF2Cxc` and `div.Ww4FFb`
  - Title from `h3`, link from `a[href]`, snippet from `.VwiC3b` / `[data-sncf]` / `.lEBKkf`, display URL from `cite`
  - Query read back from `textarea[name=q]` or `input[name=q]`
- **searchImages**: `page_global_data` — runs JS expression on `/search` page (with `udm=2`)
  - Image containers: `[data-lpage]` attribute holds the source page URL
  - Thumbnail dimensions from `img.naturalWidth` / `img.naturalHeight`
- **searchNews**: `page_global_data` — runs JS expression on `/search?tbm=nws` page
  - News containers: `div.SoaBEf`
  - Title from `.n0jPhd`, link from `a.WlydOe[href]`, source from `.MgUUmf .WJMUdc`
  - Timestamp from `.OSrXXb span[data-ts]` (Unix seconds, converted to ISO 8601)
- **searchVideos**: `page_global_data` — runs JS expression on `/search?tbm=vid` page
  - Video containers: `.Ww4FFb`
  - Title from `h3`, link from `a[href]`, source from `cite`
- **searchShopping**: `page_global_data` — runs JS expression on `/search?udm=28` page
  - Product containers: `.pla-unit`
  - Title from `.bXPcId div`, price from `.VbBaOe`, original price from `.tWaJ3e`
  - Merchant from `.UsGWMe` or `.WJMUdc`, reviews from `.yoARA`
- **getKnowledgePanel**: `page_global_data` — runs JS expression on `/search` page
  - Title from `[data-attrid="title"]`, subtitle from `[data-attrid="subtitle"]`
  - Description from `[data-attrid="SrpGenSumSummary"] span` (AI-generated summary)
  - Facts from `.rVusze` rows: label from `.w8qArf`, value from `.kno-fv`
  - Returns null fields when no knowledge panel is present for the query

## Known Issues
- **DOM selector fragility** — Google frequently A/B tests result layouts. All selectors are class-based and may drift without notice. Monitor verify fingerprints.
- **Search results cause expected DRIFT** — different results on every call. Schema validation passes; fingerprint hash changes. Normal for dynamic search endpoints.
- **Thumbnail dimensions may be 0** — `naturalWidth`/`naturalHeight` report 0 if images haven't finished loading when the extraction expression runs.
- **Regional/personalization variance** — results vary by IP geo, language, and Google account state in the browser profile.
- **News snippets may be empty** — Google News results sometimes omit snippet text, showing only title/source/date.
- **Video snippets often empty** — Video tab results frequently have no snippet text in the DOM.
- **Knowledge panel not always present** — only entity queries (people, places, organizations) produce a knowledge panel. Non-entity queries return null fields.
- **Shopping URL redirect** — `tbm=shop` is silently redirected to `udm=28` by Google. The adapter uses the `udm=28` URL directly.
- **Verify requires per-tab navigation** — automated verify can only test one page-transport operation at a time because the browser tab must be navigated to the specific search type (news, videos, shopping) before running.
