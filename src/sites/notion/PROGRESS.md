# Notion — Progress

## 2026-04-05

- Created site package: openapi.yaml (3 operations), manifest.json, DOC.md
- Operations: getSpaces, searchPages, queryDatabase
- Transport: page (Cloudflare-protected, browser-based)
- Auth: cookie_session with CSRF (cookie_to_header: notion_user_id -> x-notion-active-user-header)
- Spec written manually — compiler cannot handle Notion's RPC-style API (all endpoints collapse into one parameterized cluster)
- Added example fixtures for all 3 operations
- Verify: PASS (all 3 operations pass runtime verify with --browser)

## 2026-04-09

- Added 3 new operations: getPage, createPage, updatePage (total: 6 operations)
- getPage: direct RPC at /api/v3/loadPageChunk — returns page block tree with pagination
- createPage: adapter-based write op via submitTransaction — creates page in workspace or under parent
- updatePage: adapter-based write op via submitTransaction — updates page title
- Created adapter: adapters/notion-api.ts (pageFetch-based, handles transaction format)
- Added example fixtures for all 3 new operations
- DOC.md updated with new workflows, operations table, write safety levels
