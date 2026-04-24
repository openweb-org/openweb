# Glassdoor — Progress

## 2026-04-25 — Userflow QA

**Personas tested:**
1. Job seeker researching Stripe → search → reviews, salaries, interviews for known employer
2. Recruiter comparing Google vs Meta → reviews, salaries for both
3. Career switcher exploring Datadog → search → chained ops

**Gaps found:**

| Op | Gap | Type | Fix |
|---|---|---|---|
| searchCompanies | Returns 10 trending/popular companies regardless of query — Apollo cache `Employer:` keys include sidebar companies, not search results | wrong data | **Not fixed** — Cloudflare blocked further investigation of NEXT_DATA structure |
| getReviews | 13–15 KB for 7–8 reviews — individual pros/cons can be 3–7 KB (essay-length text) | response bloat | Capped pros/cons to 500 chars with `…` truncation |
| getSalaries | `companyName` has "Explore " prefix (from H1 "Explore Google Salaries") | wrong data | Added `.replace(/^explore\s+/i, '')` to companyName extraction |
| getSalaries | Last 1–2 entries are false positives — `salaryCount` equals `totalSalaries`, `payRange` null | wrong data | Filter entries where `salaryCount === totalSalaries && !payRange` |
| getInterviews | Cloudflare CAPTCHA blocks headless access — bot_blocked error | blocked | **Not fixed** — requires manual CAPTCHA solve in `--no-headless` mode |

**Before/after sizes (getReviews):**
- Google: 15,379 → ~3,500 B (estimated, Cloudflare prevented re-measurement)
- Meta: 13,511 → ~4,000 B (estimated)

**Blocker:** Cloudflare CAPTCHA escalation after ~6 page loads blocked all further headless access. `pnpm dev verify glassdoor` fails 0/4 ops (quarantined). The searchCompanies bug requires a `--no-headless` session to inspect the NEXT_DATA Apollo cache structure and find the correct key for actual search results.

**Key files:** `src/sites/glassdoor/adapters/glassdoor.ts`

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
