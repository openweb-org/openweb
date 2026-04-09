## 2026-04-09 — Polish pass

- Created PROGRESS.md
- DOC.md: added `← source` annotations to Operations table, marked entry points, fixed section heading hierarchy
- openapi.yaml: added realistic examples to optional params (sortBy, sortOrder, max_results, start)
- Verified all 3 operations pass runtime verify

**Verification:** `pnpm build && pnpm --silent dev verify arxiv`
