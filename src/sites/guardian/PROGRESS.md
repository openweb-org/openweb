# The Guardian — Progress

## 2026-04-24 — Userflow QA: section coverage + response trimming

**Personas tested:**
1. Opinion reader — `getSectionFeed` commentisfree → `getArticle`
2. Sports fan — `getSectionFeed` sport → `getArticle`
3. Culture enthusiast — `getSectionFeed` culture/books, `searchArticles` book reviews → `getArticle`

**Gaps found & fixed:**
- **Section description too narrow (schema/DX):** `getSectionFeed.section` listed only 10 slugs; expanded to 22 including `commentisfree`, `books`, `football`, `film`, `music`, `artanddesign`, `lifeandstyle`, etc.
- **Response noise (adapter):** Added `adapters/guardian.ts` — trims `apiUrl` (internal), `isHosted` (always false), `pillarId` (redundant); keeps `pillarName` for useful category grouping.
- **Schema/response mismatch:** Replaced `apiUrl` with `pillarName` in all three response schemas to match adapter output.
- **Browser skip:** Added `transport: node` at operation level so adapter dispatch skips unnecessary browser startup.

**Verification:** All 3 ops return 200, responses are trimmed, schema validation passes.

## 2026-04-18 — Verify Flake Investigation

**Context:** `pnpm dev verify guardian` intermittently reported `getSectionFeed: FAIL — transient error: HTTP 429` while `searchArticles` and `getArticle` passed.
**Changes:** Documentation only. Updated DOC.md § Known Issues to call out the verify-induced 429 pattern explicitly. No spec/code changes.
**Verification:**
- All three ops use `api-key` query param with default `test` (no key skew between ops).
- Isolated `pnpm dev verify guardian --ops getSectionFeed` → PASS on cold runs.
- Full-site verify (all 3 ops back-to-back, with the existing 1.5s inter-op delay in `src/lifecycle/verify.ts`) → consistent 429 on the third call (`getSectionFeed`).
- Re-run isolated immediately after a 429 → still 429 (window not yet expired); recovers after ~30-60s.
**Root cause:** Guardian Open Platform throttles the shared global `test` key well below 12 rps when callers cluster requests; verify's three sequential ops land inside the throttle window. Already correctly classified by verify as `driftType: error` / "transient error" (not auth_drift, not bot_blocked).
**Action:** Document and move on. No code change — papering over real upstream throttling with a verify-skip flag would mask genuine drift later. Users with their own free Guardian key will not see this.
**Key discovery:** Verify's `transient error` channel is the right home for shared-public-key throttling; no new failure class needed.
