## 2026-04-01: Pipeline Gaps from Boss直聘 Rediscovery

### 1. autoNavigate uses `networkidle` — unsafe for SPAs

**Problem:** `autoNavigate` in `session-executor.ts:92` uses `waitUntil: 'networkidle'`
which hangs or times out on SPA sites (Vue, React). For Boss直聘, networkidle either
never fires (SPA keeps making requests) or fires after bot detection has already
redirected the page away.

**Root cause:** `src/runtime/session-executor.ts:92` — `await newPage.goto(siteUrl, { waitUntil: 'networkidle', timeout: 15_000 })`

**Suggested fix:** Use `waitUntil: 'domcontentloaded'` + fixed wait (2-3s) instead of
`networkidle`. This matches the capture-guide.md recommendation: "Never use
`networkidle` for SPAs." The fix benefits ALL adapter-based sites, not just Boss.

### 2. `isAuthenticated` blocks unauthenticated adapter sites

**Problem:** `executeAdapter` in `adapter-executor.ts:130-139` always calls
`adapter.isAuthenticated(page)` and throws `needs_login` if false. Sites with
`requires_auth: false` must return `true` from `isAuthenticated`, but this is
non-obvious — the adapter contract implies the check is meaningful.

**Root cause:** `src/runtime/adapter-executor.ts:130-139` — unconditional auth check

**Suggested fix:** Skip `isAuthenticated` when the spec declares `requires_auth: false`
in the manifest or when server-level `x-openweb.auth` is absent. The executor already
has access to the spec — it can check. This prevents adapters from needing to lie
about auth status.

### 3. Chinese reference data APIs work via node transport

**Problem:** Prior Boss package used page transport (adapter) for ALL operations,
including reference data APIs that are public and unauthenticated. This caused all
operations to fail when bot detection blocked page navigation.

**Root cause:** The archetype guidance ("All Chinese sites require page transport")
is too broad. Reference data APIs on Chinese sites (city lists, industry codes,
filter options) are typically public REST endpoints that work via direct HTTP.

**Suggested fix:** Update `references/knowledge/archetypes/chinese-web.md` to note
that reference data APIs may work with node transport even on Chinese sites. The
"all sites use page transport" guidance should be qualified: "core operations require
page transport; reference data APIs may work with node transport."
