# Notion — Site Summary

## Coverage
- **Total operations:** 7 (4 read, 3 write)
- **Transport:** page (L3) — headed browser on port 9222
- **Auth:** cookie_session (token_v2 cookie + notion_user_id CSRF)
- **Verify:** 4/4 read ops PASS, 3 write ops skipped (unsafe_mutation)

## Read Operations (4)
| Operation | Description |
|-----------|-------------|
| getSpaces | List all workspaces for the current user |
| searchPages | Full-text search across pages and databases |
| getPage | Read a page's content — blocks, properties, parent info |
| queryDatabase | Query a database with optional filters and sort |

## Write Operations (3)
| Operation | Description | Permission | Safety |
|-----------|-------------|------------|--------|
| createPage | Create a new page in workspace or under parent | write | caution |
| deletePage | Delete (trash) a page — recoverable from Notion UI | write | caution |
| updatePage | Update a page's title | write | caution |

## API Architecture
- **Read ops:** RPC-style POST to `notion.so/api/v3/<endpoint>` — direct page transport
- **Write ops:** adapter-based via `submitTransaction` — complex transaction/operations format wrapped behind simple params
- CSRF: `notion_user_id` cookie → `x-notion-active-user-header` header
- All endpoints require `x-notion-space-id` header

## Write/Reverse Pairs
- `createPage` ↔ `deletePage`
- `updatePage` (self-reversible — update again to revert)
