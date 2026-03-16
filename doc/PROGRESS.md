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
