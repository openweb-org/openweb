# Wikipedia

## Overview
Wikipedia — free encyclopedia. Three APIs: MediaWiki Action API for search, REST v1 for summaries/media, Core REST for article source and revision history.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchArticles | search articles by keyword | GET /w/api.php?action=query&list=search&srsearch= | MediaWiki Action API, paginated |
| getPageSummary | page summary by title | GET /api/rest_v1/page/summary/{title} | REST v1 API, returns extract + thumbnail |
| getPageSource | full article wikitext source | GET /w/rest.php/v1/page/{title} | Core REST API, returns wikitext + metadata |
| getPageMediaList | images and media for a page | GET /api/rest_v1/page/media-list/{title} | REST v1 API, returns srcset + captions |
| getRandomArticle | random article summary | GET /api/rest_v1/page/random/summary | REST v1 API, same schema as getPageSummary |
| getPageRevisions | revision history for a page | GET /w/rest.php/v1/page/{title}/history | Core REST API, paginated via older_than |

## API Architecture
- Three distinct APIs on `en.wikipedia.org`:
  - **MediaWiki Action API** (`/w/api.php`) — search with `action=query&list=search&format=json`
  - **REST v1** (`/api/rest_v1/`) — clean resource-oriented endpoints for summaries, media lists
  - **Core REST** (`/w/rest.php/v1/`) — article source, revision history
- `searchArticles` requires `action`, `list`, and `format` as const params
- `getPageRevisions` supports cursor pagination via `older_than` (revision ID)
- All title parameters use underscores for spaces (e.g. `Albert_Einstein`)

## Auth
- None required

## Transport
- `node` — direct HTTP (all operations)
