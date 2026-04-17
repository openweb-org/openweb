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

## 2026-04-09 — polish pass

- Added `required` arrays to all response schemas and nested objects (sort, reducers, collection_group_results)
- Added `description` on every property at every nesting level across all 6 operations
- Added `verified: true` and `signals: [page-verified]` to all build sections
- Standardized all 6 example files: added `method`, `replay_safety` (snake_case), removed camelCase `replaySafety`
- Fixed DOC.md Site Internals heading levels (## → ###)

## 2026-04-13 — Schema Fix

**Context:** `recordMap.block` and `highlight.text` may be absent depending on page content and query context.
**Changes:** openapi.yaml — removed `required` on `recordMap.block` and `highlight.text` properties.
**Verification:** Verify pass — schema accepts responses with omitted block/highlight fields.

## 2026-04-17 — Adapter Refactor

**Context:** Normalize Notion adapter to the new `CustomRunner` shape (Phase 5C) and drop wrapper methods that didn't pull weight.
**Changes:**
- Migrated `adapters/notion-api.ts` from `CodeAdapter` (init / isAuthenticated / execute) to `CustomRunner` (`run(ctx)`); 234 → 185 lines.
- Dropped `init()` (trivial URL check) and `isAuthenticated()` (local cookie check, not a server probe).
- Folded auth signal inline: `buildHeaders` throws `errors.needsLogin()` when the `notion_user_id` cookie is missing — fires on every transactional op instead of silently sending an empty `x-notion-active-user-header`.
- Extracted `submitTransaction` helper to dedupe the POST/error-handling block across createPage / updatePage / deletePage.
**Verification:** `pnpm dev verify notion` — 4/4 ops PASS.
**Key files:** `src/sites/notion/adapters/notion-api.ts`
