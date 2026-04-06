# Notion

## Overview
Productivity and collaboration workspace. Enterprise archetype.

## Workflows

### Search pages
1. `getSpaces` → pick workspace → `spaceId`
2. `searchPages(query, spaceId)` → results with page `id`, `title`, `score`

### Query a database
1. `searchPages(query, spaceId)` → find `collection_view_page` blocks in `recordMap.block` → `collection_id`, `view_ids`
2. `queryDatabase(collectionId, viewId)` → rows with property values

**Note:** `collection_id` is found in blocks of type `collection_view_page` within search results' `recordMap.block`. It may not appear in system databases ("Home views", "My Tasks") — only user-created databases.

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getSpaces | list workspaces | — | userId, spaceId | entry point for spaceId |
| searchPages | full-text search | query, spaceId | results[].id, score, recordMap | paginated via limit |
| queryDatabase | filter/sort database rows | collectionId, viewId | blockIds, recordMap.block (rows) | needs collectionId from search |

## Quick Start

```bash
# Get workspace spaceId
openweb notion exec getSpaces '{}'

# Search pages
openweb notion exec searchPages '{"x-notion-space-id":"<spaceId>","type":"BlocksInSpace","query":"meeting","spaceId":"<spaceId>","limit":20,"source":"quick_find","filters":{"isDeletedOnly":false,"excludeTemplates":false,"navigableBlockContentOnly":false,"requireEditPermissions":false,"includePublicPagesWithoutExplicitAccess":false,"ancestors":[],"createdBy":[],"editedBy":[],"lastEditedTime":{},"createdTime":{},"inTeams":[],"excludeSurrogateCollections":false,"excludedParentCollectionIds":[]},"sort":{"field":"relevance"},"peopleBlocksToInclude":"all"}'

# Query a database (requires collectionId and viewId from search results)
openweb notion exec queryDatabase '{"x-notion-space-id":"<spaceId>","collection":{"id":"<collectionId>"},"collectionView":{"id":"<viewId>"},"loader":{"type":"reducer","reducers":{"collection_group_results":{"type":"results","limit":50}},"searchQuery":"","userTimeZone":"America/Los_Angeles"}}'
```

---

## Site Internals

## API Architecture
- RPC-style JSON API at `https://www.notion.so/api/v3/<endpointName>`
- All endpoints are POST with JSON body
- Responses include `recordMap` with denormalized entity data (blocks, collections, spaces)
- Block data is double-nested: `recordMap.block[id].value.value`

## Auth
- `cookie_session` — browser cookies forwarded (key cookie: `token_v2`)
- CSRF-like: `notion_user_id` cookie → `x-notion-active-user-header` header
- Additional required header: `x-notion-space-id` (workspace ID)

## Transport
- `page` — Notion uses Cloudflare + requires browser context
- Requests must include `x-notion-active-user-header` and `x-notion-space-id` headers

## Known Issues
- Cloudflare protection (light — browser handles it)
- Compiler cannot handle RPC-style API — all `/api/v3/*` endpoints collapse into one parameterized cluster. Spec was written manually.
- System databases ("Home views", "My Tasks") don't expose `collection_id` — they use internal sync mechanisms instead of `queryCollection`
- The `filters` object in search has many required fields — all must be present even with default values
