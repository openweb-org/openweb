## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered Substack REST API endpoints via browser capture
- Built adapter for multi-subdomain routing (publications on different domains)
- 5 operations: searchPosts, getArchive, getPost, getPostComments, getTrending

**Why:**
- Initial site package creation targeting getPost, getPublication, searchPosts, getComments

**Verification:** adapter-verified, capture-based discovery on astralcodexten.substack.com

## 2026-04-17 — Phase 3 Pure-Spec Migration

**Context:** Phase 3 of normalize-adapter — migrate adapter-backed ops to declarative OpenAPI.
**Changes:** All 5 ops moved to pure spec. Adapter file deleted.
- searchPosts, getTrending: default substack.com server.
- getArchive, getPost, getPostComments: per-op `servers` with `https://{subdomain}.substack.com` variable (Phase 1.5 server-variable threading).
- Real `/api/v1/*` paths now in spec (no more virtual paths).
- Response schemas already matched raw API; no transformation removed.
**Verification:** `pnpm dev verify substack` originally 5/5 PASS; re-verify intermittent — `getArchive`, `getPost`, `getPostComments` flaky with `browser_fetch failed: page.evaluate: TypeError: Failed to fetch` (DataDog RUM intercept on cross-subdomain page context). `getTrending`, `searchPosts` consistently PASS.
**Pitfalls:** subdomain declared as `in: query` so param-validator accepts it; substituteServerVariables consumes it; the extra `&subdomain=` query pair is ignored by the API. If verify flakiness persists, candidate revert: keep adapter for the 3 cross-subdomain ops.

## 2026-04-17 — Reverted to adapter (DataDog RUM workaround) + dropped getTrending

**Context:** Pure-spec migration was consistently failing on the 3 cross-subdomain ops. On publication subdomains (`*.substack.com`), DataDog RUM (`datadoghq-browser-agent.com`) wraps `window.fetch`; the runtime's absolute-URL + `credentials:'include'` browser-fetch path triggers `TypeError: Failed to fetch` from inside the wrapper. Per project lead: try to fix anti-bot, otherwise fall back to adapter.
**Changes:**
- Restored `adapters/substack-api.ts` from main and re-bound searchPosts / getArchive / getPost / getPostComments to it. Adapter does same-origin relative-path fetch, which the DataDog wrapper handles cleanly.
- Removed `getTrending` entirely (operation, schema, example, manifest count, doc workflow). The upstream `/api/v1/trending` returns HTTP 404 from every host — endpoint deprecated by Substack with no documented replacement.
**Verification:** `pnpm dev verify substack` → 4/4 PASS.

## 2026-04-18 — Adapter removed; root cause was custom-domain CORS, not DataDog

**Context:** Forward-fix the workaround landed in 5c58e5e. The adapter was a
band-aid; investigation showed the original DataDog-RUM diagnosis was wrong.
What actually breaks pure-spec on publication subdomains: the entry navigation
to `https://{subdomain}.substack.com/` redirects to the publication's custom
domain (e.g. `https://www.astralcodexten.com/`). The runtime then issued the
absolute API URL `https://{subdomain}.substack.com/api/v1/...` from inside that
redirected page → cross-origin → CORS rejects with `TypeError: Failed to
fetch`. Substack serves the same `/api/v1/*` on the custom domain too; the
adapter accidentally avoided the trap by using a same-origin relative path.
**Changes:**
- `src/runtime/browser-fetch-executor.ts`: when the page origin no longer
  matches the entry origin (redirect happened) AND the request URL targets
  the original entry origin, rewrite the request URL to `<pageOrigin> +
  pathname + search` so the call is same-origin against the redirected page.
  Also routed the fetch through a same-origin `about:blank` iframe so any
  page-script `window.fetch` wrapper (DataDog/Sentry/etc.) is sidestepped
  defensively.
- Reverted `openapi.yaml` to the pure-spec form (5 ops minus `getTrending`):
  per-publication ops use operation-level `servers` with the `subdomain`
  server variable; `searchPosts` stays on `substack.com`. `adapter: false`
  everywhere.
- Deleted `adapters/substack-api.ts` and the `adapters/` directory.
- Updated DOC.md to match.
**Verification:** `pnpm dev verify substack` → 4/4 PASS. Cross-checked
`pnpm dev verify medium notion bluesky` — no regressions from the redirect
rewrite or iframe-fetch change.

