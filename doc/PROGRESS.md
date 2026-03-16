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
