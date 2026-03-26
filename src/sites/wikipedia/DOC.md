# Wikipedia

## Overview
Wikipedia — free encyclopedia. Uses two APIs: MediaWiki Action API for search, REST API for summaries.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchArticles | search articles by keyword | GET /w/api.php?action=query&list=search&srsearch= | MediaWiki Action API, paginated |
| getPageSummary | page summary by title | GET /api/rest_v1/page/summary/{title} | REST v1 API, returns extract + thumbnail |

## API Architecture
- Two distinct APIs on `en.wikipedia.org`:
  - **MediaWiki Action API** (`/w/api.php`) — search with `action=query&list=search&format=json`
  - **REST v1** (`/api/rest_v1/`) — clean resource-oriented endpoints for page data
- `searchArticles` requires `action`, `list`, and `format` as const params

## Auth
- None required

## Transport
- `node` — direct HTTP
