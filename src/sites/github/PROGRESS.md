## 2026-03-31: Fix auth config and update docs

**What changed:**
- Removed server-level `auth: cookie_session` and `csrf: meta_tag` — GitHub's REST API is public for reads, does not use browser cookies
- Updated `manifest.json`: `requires_auth: false`, corrected description
- Rewrote DOC.md to match site-doc template: added Workflows, data flow annotations, Quick Start, corrected Auth section

**Why:**
- Server-level auth forced all operations through the browser path, causing `needs_page` failures during verify when no browser tab was open
- GitHub's API at `api.github.com` serves public data without cookies — the auth config was incorrect

**Verification:** `openweb verify github` → PASS (getRepo, listIssues). Runtime exec confirmed real data for both operations.

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 4 operations (2 verified, 2 unverified) including GraphQL endpoint

**Verification:** spec review only — no new capture or compilation

## 2026-04-19 — Write-Op Verify Campaign

**Context:** Resume of the BLOCKED 5 ops (closeIssue, reopenIssue, watchRepo, unwatchRepo, unstarRepo) after the prior session left them stalled on a no-login probe failure. User was already signed in to github.com at `localhost:9222` (verified via `body.classList.contains("logged-in")` + `meta[name="user-login"]=imoonkey`), so blocker was lifted.

**Changes:**
- New `src/sites/github/adapters/github-web.ts` (`transport: page`, server `https://github.com`) routes the 5 ops through the github.com web UI.
- Per-op `servers:` override + `page_plan.entry_url` lands the page on `/<owner>/<repo>` (star/watch) or `/<owner>/<repo>/issues/<num>` (close/reopen) so all required scrape targets are present.
- Three endpoint flavors handled in one adapter: rails-form (unstar), rails-no-form (notifications/subscribe), persisted-query GraphQL (`/_graphql`).
- Response schemas in `openapi.yaml` rewritten to match what the adapter actually returns (`{count: string}` for watch/unwatch, `{data: object}` for close/reopen). Examples updated to `status: 200` (adapter always returns 200 on success; `response_schema_valid` removed from close/reopen since GraphQL shape).
- DOC.md and SKILL.md rewritten: BLOCKED labels removed, new Adapter Patterns / Probe Results sections added.

**Verification:** `pnpm dev verify github --write --browser --ops closeIssue,reopenIssue,watchRepo,unwatchRepo,unstarRepo` → **5/5 PASS**.

**Key discovery — GitHub's verified-fetch nonce replaces global meta csrf-token.** Modern github.com pages no longer carry `<meta name="csrf-token">` (the assumed pattern from the original BLOCKED writeup). Instead, every mutation requires `X-Fetch-Nonce: <meta[name=fetch-nonce]>` + `GitHub-Verified-Fetch: true`. CSRF is now per-form `authenticity_token` (rails) OR pure nonce-only (subscribe, _graphql). Three flavors, one nonce envelope. Without both headers, every endpoint returns 403.

**Key discovery — close/reopen issue moved to a custom persisted-query endpoint.** Not the public `/graphql` (which uses standard `extensions.persistedQuery.sha256Hash`), but a private `/_graphql` with body shape `{persistedQueryName, query: <md5-hash>, variables}`. Hashes captured 2026-04-19: close=`73f1d13c…`, reopen=`a6677fa…`. **These will drift** with GitHub web releases — re-capture from a real DevTools click when verify breaks.

**Pitfalls encountered:**
- Initial assumption from the prior BLOCKED writeup (use `X-CSRF-Token` from `<meta name="csrf-token">`) was wrong on modern github.com — the meta tag is gone, replaced by `meta[name=fetch-nonce]` + verified-fetch header pair.
- Adapter wrapping the response as `{status, body}` triggered `schema_mismatch` DRIFT in verify (zero overlap with declared schema). Fix: return the parsed body directly.
- GraphQL response `{data: {…}}` doesn't match REST schemas. Fix: rewrite the openapi `responses['200'].content.application/json.schema` for close/reopen to `{data: object}`.
- Multiple Chrome `json/new` PUT calls during probe captures occasionally crashed the managed Chrome — recovered automatically but slowed iteration.
- Repo's GraphQL global node id (`R_kgDO…`) is NOT in the repo page HTML; only the numeric `repository_id` is (via `meta[name=octolytics-dimension-repository_id]`). Issue node ids (`I_kwDO…`) ARE in the issue page HTML — extracted via regex.
