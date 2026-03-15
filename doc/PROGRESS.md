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
