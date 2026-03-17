## M10: Compiler L2 + Semi-auto Pipeline — DONE (2026-03-17)

**Goal:** Make compiler produce usable L2 specs, expand to ~25 sites, validate semi-auto pipeline.

**Actual Result:**
- Theme 1: Compiler L2 Emit
  - Fixed signing emission bug (classify detected sapisidhash but generator never emitted it)
  - Added extraction detection (ssr_next_data, script_json) to classify.ts with ExtractionSignal type
  - Generator emits skeleton extraction operations with placeholder paths
  - Build.signals array derived from classify results (status-match, auth_detected, extraction_detected, etc.)
  - Parity test validates generated spec passes AJV x-openweb validation
  - Wired classify() into compile pipeline (loadCaptureData → classify → generatePackage)
  - Extraction-only compilation supported (zero HTTP ops + extraction signals)
- Theme 2: Site Expansion (15 → 25)
  - 10 new L1 fixtures: StackOverflow, CoinGecko, Wikipedia, npm, DuckDuckGo, JSONPlaceholder, Dog CEO, GitHub Public, REST Countries, IP API
  - Extended GitHub fixture with GraphQL POST /graphql (risk_tier: medium)
  - Fixed buildQueryUrl() body param rejection bug (enabled POST mutations)
  - All new fixtures verified against live APIs
  - Integration test configs updated for all 25 sites
- Theme 3: Semi-auto Pipeline Validation
  - Round-trip test: Open-Meteo capture → compile → compare = 4/4 operations match
  - scripts/roundtrip-test.ts for repeatable validation
- Codex Review (2 rounds, all resolved)
  - R1 (3 HIGH + 3 MEDIUM + 1 LOW): cookie_session overlap check, link_header pagination type coercion, extraction-only compile, extraction_detected on normal ops, getResponseSchema 2xx, GitHub GraphQL risk_tier, ipapi flaky flag
  - R2 (3 HIGH + 1 MEDIUM): tracking cookie deny-list, loadRecordedSamples non-throwing, extraction ops sourceUrl fallback, getResponseSchema dynamic 2xx iteration

**Exit Criteria:**
- ✅ Compiler emits signing, extraction detection, build signals
- ✅ 25 total sites (15 original + 10 new L1 + GitHub GraphQL extension)
- ✅ Round-trip pipeline validated on Open-Meteo
- ✅ 271/271 tests pass, zero regression
- ✅ 2 codex review rounds resolved (0 critical, 0 high remaining)

**Verification:** 271/271 unit tests pass; all new L1 fixtures verified against live APIs; 8 commits + 2 review fix commits

---

## 2026-03-17: M9 Codex review fixes — redirect hardening, load-time validation, schema cleanup

**What changed:**
- Redirect handling: 301/302 now rewrite POST→GET (matching native fetch); only 307/308 preserve method. Applied to both `fetchWithRedirects` and `fetchWithValidatedRedirects`.
- Cross-origin header stripping added to direct-node redirect path (`fetchWithValidatedRedirects`).
- `api_response` CSRF resolver routed through `fetchWithRedirects` (SSRF + CR-01 hardened).
- Load-time x-openweb validation: `loadOpenApi()` now runs AJV against the spec before returning, catching unsupported auth types and unknown fields early.
- `fallback` auth removed from JSON schema (kept as TS type only per D-6); `ExchangeCookieStep` schema fixed to allow `as` field.
- `request_encoding` removed from types/schema (no runtime consumer yet).
- Integration runner: pagination deps shape fixed; page verification uses parsed origin comparison.

**Why:**
- Codex review rounds 1+2 identified security gaps (SSRF bypass, header leaks) and schema/runtime drift

**Key files:** `src/runtime/redirect.ts`, `src/runtime/executor.ts`, `src/runtime/primitives/api-response.ts`, `src/lib/openapi.ts`, `src/types/primitive-schemas.ts`, `src/types/extensions.ts`
**Verification:** `pnpm build` + 260/260 tests pass; integration 9 pass, 6 skip, 1 fail (HN stale tab)
**Commit:** 3af9a50, 89ecfa2
**Next:** M9 expansion — add ~5 new sites using registry pattern
**Blockers:** None

## 2026-03-17: M9 Scale-Ready Refactor — transport model, registry, session-executor slim

**What changed:**
- Phase A: `ExecutionMode` → `Transport = 'node' | 'page'` (D-1). `direct_http` eliminated — just `node` without auth config. `XOpenWebOperation` restructured with `build` metadata block (D-15) and `request_encoding` (D-7). Primitives pruned 27 → 17 (D-5): removed 10 unimplemented types, added `fallback` auth type-only (D-6). `ExchangeStep` tightened to discriminated union (D-4). Manifest normalized: `site_url`/`compiled_at` (D-11). All 15 fixtures migrated.
- Phase B: Resolver registry (`Map<string, ResolverFn>`) replaces 3 switch statements (D-3). Session-executor extracted from 666 → 225 lines: new `request-builder.ts`, `redirect.ts` (CR-01 cross-origin header stripping), `operation-context.ts`, `csrf-scope.ts`, `response-parser.ts`. Resolve functions moved to `primitives/index.ts`. Dead code removed: `token-cache.ts`, `AdapterCapability`, `CodeAdapter.provides` (D-12). Error factory methods added (AP-8).
- Phase C: Integration test framework with real Chrome CDP. `tests/integration/runner.ts` + `sites.config.ts` with 15 site configs. Auth drift → SKIP. `pnpm test:integration` (local-only). Initial: 8 pass, 7 skip, 0 fail.
- Phase D: All docs synced — SKILL.md, architecture.md, runtime.md, primitives.md, meta-spec.md, adding-sites.md.

**Why:**
- Architecture review (M8) identified session-executor as monolithic bottleneck for scaling to 50+ sites
- Registry pattern enables adding new primitives without touching core dispatch
- Type pruning keeps schema honest — only what runtime implements is declared

**Key files:** `src/runtime/session-executor.ts` (666→225 lines), `src/runtime/primitives/registry.ts`, `src/runtime/primitives/index.ts`, `src/runtime/request-builder.ts`, `src/runtime/redirect.ts`, `src/runtime/operation-context.ts`, `src/lib/csrf-scope.ts`, `src/lib/response-parser.ts`, `src/types/primitives.ts` (27→17 types), `src/types/extensions.ts` (Transport+BuildMeta), `tests/integration/`
**Verification:** `pnpm build` ✓, 258/258 unit tests ✓, 8/15 integration tests pass (7 skip — no open tab)
**Commit:** 1dbb7e7..HEAD (5 commits)
**Next:** M9 Phase 2 — expand to ~20 sites using registry pattern; validate extensibility
**Blockers:** None

## 2026-03-16: M7 Close-out — 15 sites, 246 tests, meta-spec hardened

**What changed:**
- Phase 1 — Meta-spec maturity (3 contract fixes from TB-01/TB-02 codex review):
  - `const` requestBody fields: `validateParams()` enforces `schema.const`, callers cannot override fixed fields (e.g., GraphQL query strings)
  - Pagination `items_path`: cursor pagination supports explicit dot-path for deeply nested items (e.g., `data.actor.entitySearch.results.entities`)
  - `exchange_chain` cookie extraction: `extract_from: 'cookie'` reads browser cookies without HTTP request; `method` field supports GET steps
- Phase 2 — Targeted expansion (13→15 sites):
  - Reddit: added `getMe` via exchange_chain auth (cookie CSRF → bearer JWT → oauth.reddit.com)
  - ChatGPT: new fixture, exchange_chain with GET session endpoint, Cloudflare User-Agent binding
  - X (Twitter): new fixture, browser_fetch mode (TLS fingerprint protection), CSRF scope on all HTTP methods, static bearer as const header
  - GitHub: added test files for existing fixture
- Runtime enhancements:
  - CSRF scope: both session_http and browser_fetch support `scope` array for per-method CSRF resolution (not just mutations)
  - session_http always sends browser cookies even when auth doesn't provide cookieString
  - `findPageForOrigin()` strips `oauth.` subdomain for page matching

**Why:**
- M7 achieved meta-spec contract hardening (TB-01/TB-02 resolved) and added 2 new sites with novel patterns
- exchange_chain is now E2E verified with Reddit (cookie extraction + multi-step token exchange)
- Site expansion limited to sites with verified login state in shared Chrome profile

**Key files:** `src/lib/openapi.ts`, `src/runtime/paginator.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/runtime/session-executor.ts`, `src/runtime/browser-fetch-executor.ts`, `src/fixtures/{chatgpt,x,reddit}-fixture/`
**Verification:** 246/246 tests pass, `pnpm build` clean, 15 sites CDP-verified
**Commits:** 5 commits (Phase 1 + Reddit + ChatGPT + X + docs)
**Next:** M8 — further expansion (Nuxt SSR, non-Google signing, more breadth sites)
**Blockers:** None

---

## 2026-03-16: M6 Close-out — 13 sites, 238 tests, 6 review rounds

**What changed:**
- Closed M6 milestone: 9→13 verified sites covering 4 new archetypes (ssr_next_data, html_selector, sessionStorage_msal, graphql_cursor)
- Phase 1: 8 core hardening fixes on 9 existing sites (page matching, failureClass, requestBody, adapter errors, truncation)
- Phase 2A: Walmart, Hacker News, Microsoft Word — extraction runtime + MSAL auth
- Phase 2B: New Relic — GraphQL cursor pagination with nested `request_param` support
- exchange_chain discovery gate: FAIL → deferred (no stable target in profile)
- 6 code review rounds (3 Claude, 3 Codex), all findings resolved or documented
- Doc sync across architecture, runtime, primitives, meta-spec, adding-sites, roadmap
- Codex review fixes: prototype-safe `setValueAtPath`, tightened response schema with required fields
- Created M7 scope: meta-spec maturity + targeted expansion to ~20 sites

**Why:**
- M6 achieved its core goals: hardened runtime, proved 4 new pattern archetypes, established discovery gate discipline
- Site count (13 vs aspirational 20) was limited by exchange_chain deferral and archetypes needing new primitives (Nuxt, non-Google signing) — these carry to M7

**Key files:** all `src/runtime/`, `src/fixtures/newrelic-fixture/`, `doc/todo/v2_m6/`, `doc/todo/roadmap.md`
**Verification:** 238/238 tests pass, `pnpm build` clean, 13 sites CDP-verified
**Commits:** `fecc59c`..`5b7b193` (8 commits across Phase 1 + Phase 2A + Phase 2B + reviews + docs)
**Next:** M7 — Meta-spec maturity (const body fields, items_path, exchange_chain cookie extraction) + expansion to ~20 sites
**Blockers:** None

---

## 2026-03-16: M6 Phase 2 Tranche B — New Relic GraphQL cursor fixture + exchange_chain discovery

**What changed:**
- Added `newrelic-fixture` as site #13: first GraphQL POST fixture with `cookie_session` auth, cursor pagination via nested `data.actor.entitySearch.results.nextCursor` response path
- Extended cursor pagination runtime to support **dotted `request_param`** paths — `setValueAtPath()` in `value-path.ts` + paginator update to write cursor into nested objects (e.g., `variables.cursor` for GraphQL)
- Ran exchange_chain discovery gate against Reddit and all logged-in sites in the Chrome profile; **result: FAIL / defer** — no site meets all gate criteria (Reddit needs cookie-to-body extraction not supported by the primitive, endpoint is undocumented, logged-out returns 200/400 not 401/403)

**Why:**
- Tranche B needed a GraphQL cursor target to prove the pagination primitive works beyond flat REST APIs
- The nested `request_param` gap was a real blocker: without it, GraphQL cursor injection into `variables.cursor` required site-specific code
- exchange_chain discovery prevents shipping a flaky fixture based on unstable live behavior

**Key files:** `src/runtime/value-path.ts`, `src/runtime/paginator.ts`, `src/fixtures/newrelic-fixture/`, `doc/todo/v2_m6/exchange-chain-discovery-gate.md`
**Verification:** `pnpm test` passed (236/236), `pnpm build` passed, real Chrome CDP verified (cold-start ✓, repeated ✓, 401 unauth ✓)
**Commit:** (this session)
**Next:** Code review, then M6 Phase 2 Tranche C or close-out depending on exchange_chain defer decision
**Blockers:** exchange_chain fixture deferred — no stable target in current profile

---

## 2026-03-16: M6 Phase 2 Tranche A review fixes + Tranche B target decisions

**What changed:**
- Closed the Tranche A review gaps: `direct_http` now reuses the full path/query/header/body binding pipeline with defaults, both HTTP executors share the same redirect budget and explicit missing-`Location` error, `exchange_chain` supports `inject.query`, and `page_global_data` formally accepts `page_url`
- Fixed stale fixture and benchmark metadata: the Reddit manifest now matches the current `cookie_session` fixture, benchmark 10 includes `--max-response 2048`, and duplicated candidate-page filtering moved into shared `src/runtime/page-candidates.ts`
- Locked the next Tranche B batch in the implementation plan: `newrelic-fixture` is the GraphQL cursor target, while `exchange_chain` stays behind a discovery gate until a stable live flow is captured

**Why:**
- The Tranche A follow-up review found real contract drift between execution paths plus stale metadata left over from earlier fixture changes
- Tranche B needed a concrete "build next" target; otherwise the milestone would stall on target churn and ambiguous `exchange_chain` candidates

**Key files:** `src/runtime/executor.ts`, `src/runtime/session-executor.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/runtime/page-candidates.ts`, `src/types/primitives.ts`, `src/fixtures/reddit-fixture/manifest.json`, `doc/todo/v2_m6/implement-plan.md`
**Verification:** `pnpm test` passed (226/226), `pnpm build` passed
**Commit:** `1847175`
**Next:** Implement `newrelic-fixture` for the GraphQL cursor tranche; separately run `exchange_chain` target discovery before committing to an E2E site
**Blockers:** None

---

## 2026-03-16: M6 Phase 2 Tranche A — extraction sites, MSAL auth, and agent-surface sync

**What changed:**
- Completed the first Phase 2 tranche with three new fixtures: `walmart-fixture` (`ssr_next_data`), `hackernews-fixture` (`html_selector`), and `microsoft-word-fixture` (`sessionStorage_msal`)
- Finished the missing runtime pieces behind that tranche: extraction dispatch now also supports `page_global_data`, extraction path matching requires the configured `page_url`, nested dot-path helpers are used by extraction and cursor pagination, and navigator response summaries now render array item shapes
- Synced the local `openweb` skill and docs to the 12-site surface, including new benchmark task definitions for DOM extraction, Next.js SSR extraction, and MSAL-backed auth

**Why:**
- Phase 2 needed to add genuinely new patterns rather than more copies of the existing 9 sites
- The in-progress tranche already covered SSR extraction, DOM extraction, and MSAL auth, but it still had a runtime hole (`page_global_data` was declared but not executable) and an extraction matching bug that could silently run against the wrong same-origin page

**Key files:** `src/runtime/extraction-executor.ts`, `src/runtime/paginator.ts`, `src/runtime/navigator.ts`, `src/runtime/primitives/page-expression.ts`, `src/runtime/primitives/page-global-data.ts`, `src/fixtures/walmart-fixture/`, `src/fixtures/hackernews-fixture/`, `src/fixtures/microsoft-word-fixture/`, `.claude/skills/openweb/SKILL.md`, `doc/main/runtime.md`, `tests/benchmark/`
**Verification:** `pnpm build` passed, `pnpm test` passed (214/214), real Chrome CDP smoke passed for Hacker News/Walmart/Microsoft Word, repeated live execution passed for Hacker News/Walmart/Microsoft Word
**Commit:** `93c9893`
**Next:** Phase 2 Tranche B — pick a stable GraphQL cursor target and re-confirm the `exchange_chain` target before implementing the next site batch
**Blockers:** None

---

## 2026-03-16: M6 Phase 1 review fixes — body validation, exchange redirects, and safe truncation

**What changed:**
- Tightened request-body handling: object body params are type-checked, `requestBody.required` keeps an empty JSON object present when needed, and the Reddit vote fixture now marks `id`/`dir` as required
- Fixed `exchange_chain` auth recovery so manual 3xx redirects surface as `needs_login` instead of `fatal`
- Changed `--max-response` to emit a valid JSON string preview on stdout instead of raw byte fragments, and required a minimum of 2 bytes for that preview contract
- Added regression tests for body schema validation, required request bodies, exchange redirects, and truncation output

**Why:**
- The Phase 1 review found three contract breaks that still leaked bad inputs to HTTP, misclassified expired-session redirects, or produced unparsable stdout in the agent-safe truncation path

**Key files:** `src/lib/openapi.ts`, `src/runtime/session-executor.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/commands/exec.ts`, `src/cli.ts`, `src/fixtures/reddit-fixture/openapi.yaml`, `src/lib/openapi.test.ts`, `src/runtime/primitives/primitives.test.ts`, `src/runtime/session-executor.test.ts`, `.claude/skills/openweb/SKILL.md`
**Verification:** `pnpm test` passed (191/191), `pnpm build` passed
**Commit:** `9319297`
**Next:** M6 Phase 2 — pattern-driven expansion (Next.js SSR, DOM-only extraction, GraphQL cursor, MSAL/sessionStorage, exchange_chain E2E)
**Blockers:** None

---

## 2026-03-16: M6 Phase 1 — Core hardening on the existing 9 sites

**What changed:**
- Hardened page matching across `session_http`, `browser_fetch`, and adapter paths: worker-like pages are filtered out, unrelated-tab fallback is gone, and `needs_page` now points to a concrete URL to open
- Added request-body visibility and runtime binding: `requestBody` is modeled in OpenAPI parsing, `renderOperation()` shows body fields, body defaults are applied, and YouTube now documents `videoId` while auto-filling a minimal `context.client`
- Fixed failure classification: HTTP `401/403` now surface as `needs_login`, primitive `429/5xx` failures are retriable, webpack-cache-empty is retriable, and adapter-backed sites now throw structured `OpenWebError`s instead of plain `Error`
- Added adapter init auto-retry with reload, navigator adapter-mode rendering, CLI `--max-response`, and fixture/schema corrections (`feed_items`, YouTube body defaults)
- Synced benchmark docs and the local `openweb` skill to the new agent contract

**Why:**
- M5 dogfood exposed false-positive page selection, hidden body params, and ambiguous adapter/runtime failures that prevented reliable agent recovery
- The goal of Phase 1 is to make the existing 9 verified sites mechanically reliable before adding more patterns in Phase 2

**Key files:** `src/runtime/session-executor.ts`, `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/navigator.ts`, `src/lib/openapi.ts`, `src/lib/errors.ts`, `src/commands/exec.ts`, `src/cli.ts`, `src/fixtures/instagram-fixture/openapi.yaml`, `src/fixtures/youtube-fixture/openapi.yaml`, `.claude/skills/openweb/SKILL.md`, `tests/benchmark/`
**Verification:** `pnpm test` passed (183/183), `pnpm build` passed, real Chrome CDP smoke passed for Open-Meteo/Instagram/GitHub/YouTube/Discord/Telegram, benchmark error cases passed (`needs_browser`, `fatal`)
**Commit:** `fecc59c`
**Next:** M6 Phase 2 — pattern-driven expansion (Next.js SSR, DOM-only extraction, GraphQL cursor, MSAL/sessionStorage, exchange_chain E2E)
**Blockers:** None

---

## 2026-03-16: M5 Codex review + doc sync

**What changed:**
- Codex code review: 0 critical, 3 high, 3 medium, 3 low, 1 nice-to-have (doc/todo/v2_m5/code-review-m5.md)
- Fixed ME-3: SKILL.md `pnpm dev` → `pnpm --silent dev` (stdout contamination)
- Fixed LO-1: CLI usage errors now `OpenWebError` with `failureClass: "fatal"`
- Doc sync: architecture.md (agent skill layer + diagram), runtime.md (failureClass table), development.md (benchmark suite), adding-sites.md (benchmark checklist)
- Expanded pitfalls to 10 total from background agent reports

**Why:**
- Codex review caught real agent-contract gaps: `needs_page` unreachable, requestBody hidden, adapter errors unstructured
- 3 high findings deferred to M6 (need core runtime changes), 2 fixes applied immediately

**Key files:** `.claude/skills/openweb/SKILL.md`, `src/cli.ts`, `doc/main/architecture.md`, `doc/main/runtime.md`, `doc/dev/development.md`
**Verification:** 168/168 tests pass
**Commit:** `5de5b13..25e6b54`
**Next:** M6 — Manual Scaling + Core Hardening (pitfall fixes, 10→25 sites)
**Blockers:** None

---

## 2026-03-16: M5 — Agent Skill Dogfood + Operational Surface

**What changed:**
- Phase 1: Added `FailureClass` type (`needs_browser|needs_login|needs_page|retriable|fatal`) to `OpenWebErrorPayload` — 82 throw sites classified across 22 source files
- Phase 1: Extended `renderSite()` with readiness metadata: mode, requires_browser, requires_login, risk summary
- Phase 1: Extended `renderOperation()` to show path/header params (not just query), resolved mode, risk_tier
- Phase 2: Created 7 benchmark task definitions in `tests/benchmark/` covering all 4 execution modes
- Phase 3: Created `.claude/skills/openweb/SKILL.md` — agent skill for Claude Code with 4-step workflow, error handling guide, site table
- Phase 4: Dogfood — ran all 7 benchmarks against real Chrome CDP (6/7 pass)
- Phase 4: Documented 6 pitfalls about agent ↔ runtime interface

**Benchmark results (6/7 pass):**
- B1 open-meteo (direct_http): PASS
- B2 Instagram (session_http, cookie + CSRF): PASS
- B3 GitHub (session_http, meta_tag + pagination): PASS
- B4 YouTube (session_http, page_global + sapisidhash): FAIL — findPageForOrigin matched service worker instead of real page
- B5 Discord (browser_fetch, webpack_module_walk): PASS
- B6 Telegram (L3 adapter): PASS — after page reload (backgrounded tab lost webpack state)
- B7 Error classification: PASS — needs_browser + fatal correctly surfaced

**Pitfalls (doc/todo/v2_m5/pitfalls.md):**
1. Service worker pages match in findPageForOrigin — misleading error
2. Backgrounded tabs lose webpack/global state — need reload hint
3. renderOperation didn't show path params — FIXED in this milestone
4. Large responses (~156KB) overwhelm agent context — need --jq or truncation
5. No pre-execution readiness check — need `openweb <site> check`
6. page_global failure misclassified as needs_login when real issue is wrong page type

**Key files:**
- `src/lib/errors.ts` — FailureClass type + failureClass field
- `src/runtime/navigator.ts` — readiness metadata + full param display
- `.claude/skills/openweb/SKILL.md` — agent skill package
- `tests/benchmark/` — 7 benchmark task definitions
- `doc/todo/v2_m5/pitfalls.md` — 6 pitfalls for M6 scope

**Verification:** 168/168 tests pass, 10 sites available, readiness metadata displayed, failureClass in all error output, 6/7 benchmarks pass
**Commit:** `94916d8..57b7c73` (4 commits)
**Next:** M6 — Manual Scaling + Core Hardening (pitfall fixes, 10→25 sites)
**Blockers:** None

---

## 2026-03-16: Post-M4 planning — roadmap, meta-schema review, design docs

**What changed:**
- Separated `doc/todo/roadmap.md` from `doc/todo/note.md` — M5-M8 milestones defined
- M5: Agent Skill MVP (9 sites, pure packaging)
- M6: Manual Scaling + Core Hardening (10→25 sites, primitive registry, freshness, extraction handlers)
- M7: Semi-Auto Discovery (25→50 sites, compiler L2 classify, AsyncAPI, self-healing)
- M8: Full Automation + Distribution (50→100+, self-evolution, package registry)
- New design docs:
  - `doc/todo/meta-schema-review/` — auth/csrf/signing 分类体系 review, mode 轴分析
  - `doc/todo/primitive-customization/` — registry + per-site resolver 设计
  - `doc/todo/intelligent-discovery/` — agent-driven API exploration workflow
- Removed site-specific `webpackChunkdiscord_app` + `webpackChunk_N_E` from dom-capture KNOWN_GLOBALS (redundant with wildcard scan)

**Why:**
- M0-M4 complete — need clear roadmap for M5+ that covers all v2 design doc commitments
- Meta-schema review identified: page_global duplication, 3-switch code smell, missing freshness dimension, extraction as wrong category
- Primitive customization needed before scaling to 100+ sites (company-specific primitives in core don't scale)

**Key files:** `doc/todo/roadmap.md`, `doc/todo/note.md`, `doc/todo/meta-schema-review/review.md`, `doc/todo/primitive-customization/design.md`, `doc/todo/intelligent-discovery/design.md`, `src/capture/dom-capture.ts`
**Verification:** 167/167 tests pass, Discord getMe verified via CDP after KNOWN_GLOBALS cleanup
**Commit:** `375def2`
**Next:** M5 — Agent skill MVP
**Blockers:** None

---

## 2026-03-16: Documentation overhaul — doc/main + doc/dev rewrite

**What changed:**
- Rewrote `doc/main/` from 2 files to 9 files, modeled after Android Agent doc quality
- New navigation hub: `doc/main/README.md` (documentation map, reading order, key concepts)
- New docs: `runtime.md` (execution pipeline), `primitives.md` (L2 resolvers), `adapters.md` (L3 framework), `meta-spec.md` (type system), `compiler.md` (pipeline), `security.md` (SSRF, errors, redirects)
- Rewrote `doc/main/architecture.md` and `doc/main/browser-capture.md` with deeper content
- Rewrote `doc/dev/development.md` with complete dev workflow
- New: `doc/dev/adding-sites.md` — step-by-step guide for creating new site fixtures
- Removed outdated `doc/dev/guide.md` and `doc/dev/m1-plan.md`

**Why:**
- M0-M4 complete — documentation hadn't kept up with implementation
- Previous docs were sparse (2 main files, 1 dev file) for a system with 9 verified sites and 167 tests
- Reference quality: Android Agent project's doc/main structure

**Key files:** `doc/main/*.md` (9 files), `doc/dev/*.md` (2 files)
**Verification:** All file/code references verified against current codebase
**Commit:** `a34cc32`
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 Codex Review Round 2 — 4 fixes

**What changed:**
- HI-01: Replaced broken `redirect:'manual'` (opaqueredirect status 0) with `redirect:'follow'` — browser handles redirects natively, initial URL SSRF-validated
- HI-02: Added `scripts/build-adapters.js` — compiles .ts adapters to .js via esbuild as post-build step
- HI-03: Extracted shared `validateParams()` in openapi.ts — unknown-param rejection, required checks, type validation, defaults — used by adapter and non-adapter paths
- ME-01: Adapter loader distinguishes "file not found" from "wrong shape" (missing default export)

**Why:**
- Round 2 found `redirect:'manual'` returns opaqueredirect in browser context (status 0, no headers) — per-hop loop was dead code
- Built-mode adapter loading still failed because build only emitted dist/cli.js, not adapter .js files
- Adapter param validation was still partial (no unknown rejection, no type checks)

**Key files:** `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/executor.ts`, `src/lib/openapi.ts`, `scripts/build-adapters.js`
**Verification:** 167/167 tests pass, `pnpm build` compiles 2 adapters, built-mode adapter import verified
**Commit:** `f62f1fd..8ee80a0` (2 commits)
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 Codex Review Round 1 — 4 fixes

**What changed:**
- CR-01: browser_fetch SSRF redirect bypass — `redirect:'manual'` + per-hop validation
- HI-01: adapter loader surfaces real import errors (not "adapter not found" for syntax errors)
- HI-02: adapter execution path validates required params + applies schema defaults
- ME-03: in-page fetch network/CORS errors normalized to `OpenWebError`

**Why:**
- Codex review identified that browser_fetch only validated the initial URL, not redirect targets
- `.ts` adapters fail under built runtime (`node dist/cli.js`); blanket catch hid the real error
- Adapter operations bypassed OpenAPI parameter validation entirely

**Key files:** `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/executor.ts`
**Verification:** 167/167 tests pass, TypeScript build clean
**Commit:** `767d18d..f62f1fd` (2 commits)
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 — L3 + browser_fetch (Discord, WhatsApp, Telegram)

**What changed:**
- Phase 0: `browser_fetch` executor — `page.evaluate(fetch(...))` with credentials:'include'
- Phase 1: Discord — `webpack_module_walk` L2 auth primitive + browser_fetch fixture (3 ops)
- Phase 2: L3 adapter framework — CodeAdapter loading via dynamic import + init/auth/execute lifecycle
- Phase 3: WhatsApp — L3 adapter via Meta `require()` module system (getChats, getMessages, getContacts)
- Phase 4: Telegram — L3 adapter via dynamic webpack `getGlobal()` state discovery (getDialogs, getMe, getMessages)
- Code review: SSRF validation in browser_fetch, path traversal guard in adapter loader, chunk_global format check
- Pitfall feedback: 8 pitfalls written back to 3 design docs (layer3-code-adapters, runtime-executor, layer2-primitives)

**Why:**
- M4 proves the three-layer architecture works end-to-end (L1 + L2 + L3 all running)
- `browser_fetch` needed for sites with TLS fingerprinting or browser-only auth (webpack module cache)
- L3 adapters handle sites with no HTTP API (WhatsApp Signal Protocol, Telegram MTProto)
- Key discovery: WhatsApp uses Meta's proprietary `__d/__w/require`, not standard webpack
- Key discovery: Telegram-t module IDs are mangled per deploy — adapter must search dynamically

**Key files:**
- `src/runtime/browser-fetch-executor.ts` — browser_fetch mode
- `src/runtime/adapter-executor.ts` — L3 adapter framework
- `src/runtime/primitives/webpack-module-walk.ts` — webpack auth primitive (10th L2 handler)
- `src/fixtures/discord-fixture/` — webpack_module_walk + browser_fetch (getMe, getGuilds, getChannelMessages)
- `src/fixtures/whatsapp-fixture/` — L3 adapter + Meta require() (getChats, getMessages, getContacts)
- `src/fixtures/telegram-fixture/` — L3 adapter + teact getGlobal() (getDialogs, getMe, getMessages)
- `src/types/adapter.ts` — CodeAdapter interface (Page-typed)

**Verification:** 167/167 tests pass, TypeScript strict build clean, all 3 sites verified with real Chrome CDP:
- Discord: `getMe` returns user object ✅, `getGuilds` returns 3 guilds ✅
- WhatsApp: `getChats` returns chat list ✅, `getContacts` returns 2574 contacts ✅
- Telegram: `getMe` returns user ✅, `getDialogs` returns 63 dialogs ✅

**Commit:** `73d244b..2b53bfd` (8 commits)
**Next:** M5 — Agent skill packaging + self-healing
**Blockers:** None

---

## 2026-03-16: M3 — L2 Breadth (4 Diverse Websites)

**What changed:**
- Phase 0 (M2 debt): request body construction for POST/PUT/PATCH, pagination executor (cursor + link_header), token cache with TTL
- Phase 1: Bluesky — `localStorage_jwt` auth primitive + cursor pagination fixture
- Phase 2: GitHub — `meta_tag` CSRF, `script_json` extraction, `link_header` pagination fixture
- Phase 3: YouTube — `page_global` auth, `sapisidhash` SHA-1 signing primitive + fixture
- Phase 4: Reddit — `exchange_chain` auth, `api_response` CSRF primitives (fixture uses `cookie_session` via `.json` endpoints)
- Phase 5: Filled all 10 M2 test checklist gaps (CR-15 redirects, CR-16 SSRF, CR-17 $ref, CR-18 non-JSON, CR-20 partial cookies)
- Bug fixes: CSS selector injection in meta_tag (CSS.escape), redirect off-by-one, page selection by origin for page.evaluate
- Classify detectors: added `localStorage_jwt`, `meta_tag`, `sapisidhash`, `exchange_chain` detection
- Design doc pitfall feedback: 14 pitfalls documented across 4 design docs

**Why:**
- M3 proves the L2 primitive model generalizes across diverse auth/CSRF/signing/pagination patterns
- 9 out of 27 primitive types now have runtime handlers — covering the most common web auth patterns
- Page selection bug (context.pages()[0]) was a critical E2E failure that only surfaced with multiple Chrome tabs
- Reddit's exchange_chain endpoint required undocumented params; simpler cookie_session via .json URLs works

**Key files:**
- `src/runtime/primitives/` — 9 handler files (localstorage-jwt, page-global, sapisidhash, meta-tag, api-response, exchange-chain, script-json + existing cookie-session, cookie-to-header)
- `src/runtime/paginator.ts` — pagination executor (cursor + link_header)
- `src/runtime/token-cache.ts` — TTL-based auth token cache
- `src/runtime/session-executor.ts` — signing pipeline, body construction, page selection
- `src/compiler/analyzer/classify.ts` — 6 detectors (cookie_session, cookie_to_header, localStorage_jwt, meta_tag, sapisidhash, exchange_chain)
- `src/fixtures/{bluesky,github,youtube,reddit}-fixture/` — 4 new site fixtures

**Verification:** 145/145 tests pass, TypeScript strict build clean, all 4 sites verified with real Chrome CDP:
- GitHub: `getRepo` anthropics/claude-code ✅, `listIssues` ✅
- Bluesky: `getProfile` bsky.app ✅, `getTimeline` ✅, `searchActors` ✅
- YouTube: `getVideoInfo` (Never Gonna Give You Up) ✅
- Reddit: `getSubreddit` r/programming ✅

**Commit:** `1c9858b..5776d5c` (12 commits)
**Next:** M4 — L3 + browser_fetch mode (Discord, WhatsApp/Telegram)
**Blockers:** None

---

## 2026-03-15: M2 Hardening — Final polish (NI-01, NI-02, test checklist)

**What changed:**
- NI-01: `resolveMode()` now validates server-level mode (was only validating operation-level)
- NI-02: session_http redirect loop exhaustion now throws "Too many redirects" instead of "HTTP 302"
- Created M3 test coverage checklist from deferred CR-15/16/17/18/20

**Why:**
- Round 2 review found 2 low-severity gaps introduced by round 1 fixes — closed the loop
- Test checklist ensures deferred items aren't forgotten in M3

**Key files:** `src/runtime/session-executor.ts`, `doc/todo/v2_m3/m3-test-checklist.md`
**Verification:** 84/84 tests pass
**Commit:** `7a29d5a`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 Hardening — Code Review Fixes (9 findings)

**What changed:**
- CR-01: Strip Cookie/Authorization/CSRF headers on cross-origin redirects (security)
- CR-05: `browser_fetch` mode throws "not yet implemented" instead of silent fallthrough
- CR-07: 303 See Other redirect switches method to GET per RFC 7231
- CR-08: Unreplaced path template variables `{param}` throw INVALID_PARAMS
- CR-09: Safe JSON parse in direct_http path (consistent with session_http)
- CR-10: Validate ExecutionMode values from spec (reject typos like "sesion_http")
- CR-12: `--cdp-endpoint` without value shows usage error
- CR-13: Guard `$ref` traversal against `__proto__`/`constructor`/`prototype`
- spec_version aligned from "0.1.0" to "2.0" to match design docs

**Why:**
- Parallel code review + architecture review by two Claude agents (multmux) found 20 code issues + full gap matrix
- Fixed all findings except those better suited for M3 (request body, generator `in` field, operation-level server lookup, SSRF TOCTOU)

**Key files:** `src/runtime/session-executor.ts`, `src/runtime/executor.ts`, `src/cli.ts`, `src/compiler/generator.ts`
**Verification:** 84/84 tests pass, TypeScript strict clean on all modified files
**Commit:** `0d92195`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 Fix — Cookie scoping + Referer + real Instagram verification

**What changed:**
- Fixed `context.cookies()` to scope by server URL — without URL arg, Playwright returns cookies from ALL domains in the Chrome profile, which created a massive Cookie header that Instagram rejected with 400
- Added `Referer: {server_origin}/` to all session_http requests — Instagram requires this header
- Made exec command JSON params optional (default `{}`), added `--cdp-endpoint` flag
- Verified against real Instagram API: `getTimeline` and `getUserProfile` return real data

**Why:**
- Initial 400 errors were misattributed to TLS fingerprinting. Bisecting headers proved: curl (LibreSSL), Node.js (OpenSSL), and Chrome (BoringSSL) all succeed — the issue was HTTP-level, not TLS
- `context.cookies()` scoping is a critical pitfall for any session_http implementation using a real user Chrome profile

**Key files:** `src/runtime/primitives/cookie-session.ts`, `src/runtime/primitives/cookie-to-header.ts`, `src/runtime/session-executor.ts`, `src/commands/exec.ts`, `src/cli.ts`
**Verification:** `openweb exec instagram-fixture getTimeline` → 200, real feed JSON. `getUserProfile` → 200, real user data. 84/84 tests pass.
**Commit:** `b6733ca`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 — First L2 Website End-to-End (Instagram)

**What changed:**
- Implemented `session_http` execution mode with CDP browser connection
- Added L2 primitive resolvers: `cookie_session` (extract all cookies), `cookie_to_header` (cookie value → CSRF header)
- Extended `executeOperation()` to dispatch `session_http` vs `direct_http` by mode detection
- Added path parameter substitution (`{user_id}`), header parameter handling (`X-IG-App-ID` with defaults), `$ref` component resolution
- Implemented Compiler Classify step: detects `cookie_session` + `cookie_to_header` patterns from capture data (HAR entries + state snapshots)
- Extended generator to emit server-level `x-openweb` (mode + auth + csrf) when ClassifyResult is provided
- Added `deriveRiskTier()`: GET=safe, POST/PUT/PATCH=medium, DELETE=high
- Code review fixes: safe JSON parsing, redirect following with SSRF validation, guard against unresolvable `$ref`, empty serverUrl error

**Why:**
- M2 proves the L2 primitive model works end-to-end on a real website (Instagram)
- First website requiring authentication (cookie_session) and CSRF protection (cookie_to_header)
- Validates the full pipeline: capture → classify → emit → execute

**Key files:**
- `src/runtime/primitives/` — BrowserHandle, ResolvedInjections types + cookie-session + cookie-to-header resolvers
- `src/runtime/session-executor.ts` — session_http execution: CDP browser, L2 primitive resolution, path/header/query params
- `src/runtime/executor.ts` — mode dispatch (direct_http vs session_http)
- `src/compiler/analyzer/classify.ts` — Classify step (cookie_session + cookie_to_header detection)
- `src/compiler/generator.ts` — x-openweb emission with ClassifyResult

**Verification:** 84/84 tests pass (27 new), TypeScript strict clean on all new files
**Commit:** `a8fce3b`
**Next:** M3 — L2 breadth (5 diverse websites: Bluesky, YouTube, GitHub, Sentry, Reddit)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 3

**What changed:**
- Instagram fixture: added `X-IG-App-ID` as reusable OpenAPI header parameter via `$ref`
- Schema: added `minimum` constraints on `tool_version` (>=1) and stats counts (>=0)
- Schema: added `minItems: 1` on `exchange_chain.steps`, `minProperties: 1` on `html_selector.selectors`
- Validator: hardened operation-level op guard from `if (!op)` to `typeof op !== 'object'`

**Why:**
- Codex round 3 found Instagram fixture was missing documented `X-IG-App-ID` header
- Schema accepted semantically impossible values (negative counts, empty chains)
- Last remaining falsy guard in operation traversal

**Key files:** `src/fixtures/instagram-fixture/openapi.yaml`, `src/types/schema.ts`, `src/types/primitive-schemas.ts`, `src/types/validator.ts`
**Verification:** 57/57 tests pass, lint clean
**Commit:** see below
**Next:** M2 — First L2 website end-to-end (Instagram)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 2

**What changed:**
- Fixed top-level shape guard: `validateXOpenWebSpec()` now rejects `null`, `undefined`, primitives, and arrays instead of crashing/passing silently
- Added safe container guards: `servers` checked as array, `paths` checked as object before traversal
- Added operation-level falsy regression test (round 1 only tested server-level)
- Tightened `AdapterRef.params` type to exclude arrays (`{ readonly [key: string]: unknown }` instead of `Readonly<Record<string, unknown>>`)
- Acknowledged s1 (manifest site/site_url coexistence) — both accepted by schema for v1→v2 migration

**Why:**
- Codex round 2 found the validator crashes on `null` and passes on non-object inputs — boundary hardening for untrusted parser output

**Key files:** `src/types/validator.ts`, `src/types/validator.test.ts`, `src/types/extensions.ts`
**Verification:** 57/57 tests pass, lint clean
**Commit:** see below
**Next:** M2 — First L2 website end-to-end (Instagram)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 1

**What changed:**
- Fixed falsy x-openweb guard: `if (!ext)` → `if (ext == null)` so `false`/`0`/`''` are properly rejected
- Added 4 edge case tests: falsy values, missing required auth fields, signing validation, csrf with scope
- Deferred: operation-level `servers[]` validation + `trace` method (rare in practice)
- Deferred: `info.x-openweb` validation (metadata, not execution primitive)

**Why:**
- Codex review probed for false negatives and found the falsy guard silently accepted invalid specs

**Key files:** `src/types/validator.ts`, `src/types/validator.test.ts`
**Verification:** 55/55 tests pass, lint clean
**Commit:** `94fce98`
**Next:** Codex round 2 review, then M2
**Blockers:** None

---

## 2026-03-15: M1 — Meta-spec Formalization

**What changed:**
- Created `src/types/` module with all 27 L2 primitive types as readonly discriminated unions
- JSON Schema definitions (AJV) for x-openweb server/operation extensions and manifest.json
- `validateXOpenWebSpec()` validates all x-openweb extensions in an OpenAPI spec
- `validateManifest()` validates manifest.json against schema
- `CodeAdapter` interface + `AdapterCapability` types for L3
- Instagram fixture (`src/fixtures/instagram-fixture/`) as L2 validation sample (cookie_session + cookie_to_header CSRF)
- Code reviewed: fixed csrfWithScope allOf→oneOf composition, manifest type/schema drift, file split for 400-line limit

**Why:**
- M1 formalizes the v2 design docs into executable TypeScript types + JSON Schema
- Single source of truth: JSON Schema validates at runtime, TypeScript types enforce at compile time
- Enables M2 (runtime execution of L2 primitives) by providing type-safe x-openweb definitions

**Key files:**
- `src/types/primitives.ts` — 27 L2 primitive discriminated unions (auth/csrf/signing/pagination/extraction)
- `src/types/primitive-schemas.ts` — JSON Schema for all primitives
- `src/types/extensions.ts` — XOpenWebServer, XOpenWebOperation
- `src/types/schema.ts` — composite schemas (server/operation/manifest)
- `src/types/validator.ts` — AJV-based validation
- `src/types/validator.test.ts` — 13 tests
- `src/fixtures/instagram-fixture/` — L2 fixture

**Verification:** 51/51 tests pass, lint clean, tsc strict clean (0 errors in src/types/)
**Commit:** `4ac0e7b..c3cf4ee`
**Next:** M2 — First L2 website end-to-end (Instagram: cookie_session + cookie_to_header)
**Blockers:** None

---

## 2026-03-15: M0 Hardening — Codex Code Reviews (3 rounds)

**What changed:**
- Round 1 (d5ce87a): stale bundle cleanup, in-flight data drain, snapshot ordering, cancellable connect, broadened HAR filter (SSE + wildcard +json), requestfailed cleanup, deferred() for TS strict
- Round 2 (996682d): safe bundle cleanup (artifact-only rm), draining flag for in-flight snapshots, drain-before-detach ordering, URL at event time, AbortSignal races connect + sleep
- Round 3 (ca1ba52): pendingCount includes pre-response requests, skip snapshot if page navigated away (rapid redirect correctness)

**Why:**
- Three Codex review rounds identified and fixed all critical/high reliability issues
- Capture output is now safe (no user data loss), deterministic (stop timing, reruns), and correct (rapid redirects skip stale snapshots)

**Key files:** `src/capture/session.ts`, `src/capture/har-capture.ts`, `src/capture/connection.ts`, `src/capture/bundle.ts`
**Verification:** 38/38 tests pass, lint clean, build clean
**Commit:** `d5ce87a..ca1ba52`
**Next:** M1 — Formalize meta-spec (TypeScript types + JSON Schema for x-openweb)
**Blockers:** None

---

## 2026-03-15: M0 — Browser Capture via CDP

**What changed:**
- Installed Playwright chromium browsers (all 34 tests now pass, was 24/25)
- Implemented capture module (`src/capture/`) with 4 data sources:
  - HTTP traffic (HAR 1.2) with analytics/tracking domain filtering (~30 blocked domains)
  - WebSocket frames (JSONL) via CDP `Network.webSocket*` events
  - Browser state snapshots (localStorage, sessionStorage, cookies) on init + navigation
  - DOM & globals extraction (meta tags, hidden inputs, 20+ framework globals detection)
- Added `openweb capture start/stop --cdp-endpoint <url>` CLI command
- Capture outputs bundle directory: `traffic.har`, `websocket_frames.jsonl`, `state_snapshots/`, `dom_extractions/`, `metadata.json`
- Code reviewed: fixed critical issues (new-tab HAR entries lost, navigation snapshot race condition), all lint errors resolved

**Why:**
- M0 is the foundation for the compiler pipeline — all subsequent phases (clustering, pattern detection, spec emission) consume the capture bundle
- CDP connection model allows OpenWeb to passively observe alongside the agent's Playwright CLI session without owning the browser

**Key files:**
- `src/capture/*.ts` — 8 modules (types, connection, har-capture, ws-capture, state-capture, dom-capture, bundle, session)
- `src/commands/capture.ts` — CLI command handler
- `src/cli.ts` — capture command registration
- `src/capture/*.test.ts` — 9 unit tests (HAR filtering + bundle writing)

**Verification:** Tested against real Chrome (--remote-debugging-port=9222) capturing JSONPlaceholder — 3 API requests, 4 state snapshots, 4 DOM extractions captured correctly. Build + lint + 34/34 tests pass.

**Commit:** `860fc97`

**Next:** M1 — Formalize meta-spec (TypeScript types + JSON Schema for x-openweb)

**Blockers:** None

---

## 2026-03-15: v2 Three-Layer Architecture — Full Design Sprint

**What changed:**
- Wrote all 10 v2 design documents from scratch (layer2-interaction-primitives, pattern-library, compiler-pipeline, browser-integration, layer3-code-adapters, runtime-executor, skill-package-format, gap-coverage-matrix, security-taxonomy, self-evolution)
- Classified all 103 OpenTabs plugins into L1/L2/L3 layers
- Defined 27 L2 primitive types across 5 categories (auth, csrf, signing, pagination, extraction)
- Created Chinese summaries of all docs (doc/todo/v2/cn/)
- Reorganized doc structure: doc/final → doc/todo/v2, docs/todo → doc/todo, outdated content → doc/archive
- Drafted v2 roadmap (M0-M5) in doc/note.md
- Key design decisions:
  - Phase 3 "Probe & Pattern Match" merged into single "Classify" step (primitives determine min mode, probe verifies)
  - AsyncAPI stays pure standard (no x-openweb), WS auth uses shared token from openapi.yaml
  - sapisidhash reclassified as session_http (SHA-1 computable in Node.js)
- Created doc/main/architecture.md and doc/dev/guide.md (SOTA memory)

**Why:**
- v1 HAR-only approach had 12 fundamental design gaps (discovered from OpenTabs analysis)
- Three-layer architecture (L1 structural + L2 primitives + L3 code) resolves all 12 gaps
- L1+L2 covers 93% of sites, only 7% need L3 code adapters
- Design validated against 103 real OpenTabs plugins, not hypothetical sites

**Key files:**
- `doc/todo/v2/*.md` — 10 design docs (all COMPLETE)
- `doc/todo/v2/cn/*.md` — Chinese summaries
- `doc/note.md` — artifacts definition + M0-M5 roadmap
- `doc/main/architecture.md` — architecture overview (SOTA)
- `doc/dev/guide.md` — dev guide (SOTA)

**Verification:** Cross-doc consistency check passed (terminology, types, cross-references all aligned)

**Commits:** `890e374..25e9f9d` (22 commits)

**Next:** M0 — Playwright browser capture integration

**Blockers:** None
