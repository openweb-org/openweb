# Glassdoor — Progress

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate `CodeAdapter` shim to shared `CustomRunner` contract (commit 72c0479).
**Changes:**
- `src/sites/glassdoor/adapters/glassdoor.ts`: 409 → 392 lines; now imports `CustomRunner`, `PreparedContext`, `AdapterHelpers` from shared types and exports `run(ctx)`
- Removed local `interface CodeAdapter` shim
- Dropped trivial `init()` (URL check) and `isAuthenticated()` (always-true, no server probe)
- Cloudflare wait loop (`isCloudflareBlocked` + `waitForCloudflare` + pre-dispatch CF gate) preserved byte-for-byte by moving from `execute` into the `run(ctx)` preamble — runs before every op
- CF timeout error switched from ad-hoc `Object.assign({failureClass:'bot_blocked'})` to `errors.botBlocked(...)`
- Inline `throw new Error('X is required')` replaced with `errors.missingParam(...)`

**Verification:** 4/4 ops PASS

**Key files:** `src/sites/glassdoor/adapters/glassdoor.ts`

## 2026-04-14: Transport upgrade — GraphQL API for reviews + interviews

**What changed:**
- **getReviews**: Upgraded from Tier 2 (DOM text parsing) to Tier 5 hybrid (page navigate + `page.evaluate(fetch)` to `/graph` GraphQL). Extracts review IDs from `data-brandviews` attribute, then fetches each via `EmployerReview` GraphQL query. Returns structured `pros`, `cons`, `ratingOverall`, `reviewDateTime`, `summary`, `jobTitle`. Overall rating now extracted from JSON-LD.
- **getInterviews**: Upgraded from Tier 2 (body text splitting) to Tier 4+5 hybrid (response interception of `EmployerInterviewInfoIG` GraphQL during navigation). Returns clean `processDescription` and `jobTitle` from GraphQL. DOM metadata (date, difficulty, etc.) unreliable with current page structure.
- **searchCompanies**: Unchanged (Tier 3 — SSR/NEXT_DATA already stable)
- **getSalaries**: Unchanged (Tier 2 — no GraphQL discovered for salary data)
- DOC.md: Updated transport tiers, documented GraphQL operations, updated known issues

**Key discoveries:**
- GraphQL `/graph` endpoint: POST with `gd-csrf-token: 1` (static), `credentials: include`
- Introspection disabled — only pre-defined query shapes succeed
- `EmployerReview` query returns 3+ reviews per call (requested + recommendations) — deduplicated
- `EmployerInterviewInfoIG` returns only `processDescription` + `jobTitle` — no date/difficulty/experience
- No GraphQL for salary data — salary page only fires `RecordPageView` mutation

**Verification:** All 4 operations verified with `--browser --no-headless` for Google (E9079) and Microsoft (E1651)

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- DOC.md: added `---` separator before Site Internals, tightened wording
- openapi.yaml: added `description` on all nested objects (no bare `type:object`), added `example` on required params, added `default` where applicable
- All 4 example files present with `replay_safety`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify glassdoor`
