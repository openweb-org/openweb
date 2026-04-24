## 2026-04-01: Fresh rediscovery — 3 operations (searchDrugs, getDrugPrices, getPharmacies)

**What changed:**
- Rediscovered GoodRx from scratch with 3 target operations
- Adapter-only site: PerimeterX blocks all direct HTTP, data in DOM/JSON-LD
- searchDrugs: autocomplete via search input interaction
- getDrugPrices: DOM extraction from pharmacy price list items + JSON-LD Drug schema
- getPharmacies: DOM extraction of pharmacy links from pharmacy-near-me page

**Why:**
- Prior package (10 ops) deleted; rebuilding with focused scope

**Verification:** adapter-verified via openweb verify goodrx --browser

## 2026-04-14 — Transport Upgrade Probe: No __NEXT_DATA__

**Context:** Investigated `__NEXT_DATA__` extraction for transport upgrade from Tier 2 (DOM) to Tier 3 (SSR).
**Findings:**
- GoodRx uses Next.js **App Router (RSC)**, not Pages Router — no `__NEXT_DATA__` script tag
- `_next/` asset paths present on drug pages, confirming Next.js, but RSC delivers data via React Server Components, not `__NEXT_DATA__`
- No other SSR globals: `__INITIAL_STATE__`, `__APOLLO_STATE__`, `__NUXT__` all absent
- Node HTTP returns 403 (PerimeterX) — no node transport path
- LD+JSON (`MedicalWebPage`, `Drug`) available on drug pages; already used by adapter
**Decision:** No upgrade viable. Staying on `transport: page` with adapter DOM/JSON-LD extraction.

## 2026-04-13 — PerimeterX Mitigation

**Context:** PerimeterX bot detection blocks requests across operations, especially during sequential verify runs where cookies become poisoned.
**Changes:** Added inter-op delay and browser context recovery in `adapters/goodrx-web.ts` — `navigateWithPxRetry` clears cookies and resets to `about:blank` before each navigation attempt, with progressive backoff (1s + attempt * 1s). Adapter `init` also clears cookies if a PX CAPTCHA is detected from prior warm-up.
**Verification:** Sequential operations no longer cascade-fail from poisoned PX state; retry loop recovers within 4 attempts.

## 2026-04-17 — Adapter Removal: Spec-Only Migration

**Context:** Phase-4 normalize-adapter sweep — eligible page-transport sites move off custom adapters onto the declarative `page_global_data` extraction primitive.
**Changes:**
- All 3 ops (`searchDrugs`, `getDrugPrices`, `getPharmacies`) converted to `extraction.type: page_global_data` with inline JS expressions ported from the adapter's DOM-scrape paths
- Server-level `page_plan: { warm: true }` replaces the adapter's homepage warm-up
- `searchDrugs` now navigates to `/search?query={query}` (instead of homepage + `/api/autocomplete`); `evaluatePageExpression` blocks `fetch()`, so the API path was dropped in favor of the existing DOM-link scan
- `adapters/goodrx-web.ts` deleted (200 lines removed)
**Verification:** `pnpm dev verify goodrx --browser` → 3/3 PASS against production goodrx.com
**Key discovery:** PagePlan's `warm: true` was insufficient on its own — `warmSession` previously only did a fixed 3 s delay and let PerimeterX-blocked pages through. Extended `warmSession` with post-warm bot detection + clearCookies/re-navigate retry (default 3 attempts). This generalizes the adapter's hand-coded `navigateWithPxRetry` so any spec-only site using `warm: true` inherits PX recovery.
**Pitfalls encountered:** First verify pass returned `bot_blocked 0/3` because the runtime had no retry loop. Adding the `botRetries` extension to `warmSession` flipped it to PASS without per-site code.

## 2026-04-25 — Userflow QA: Blocked by PerimeterX CAPTCHA

**Context:** Userflow QA — designed 3 blind persona workflows to validate end-to-end:
1. **Caregiver**: searchDrugs("metformin") → getDrugPrices → getPharmacies (find cheapest pharmacy)
2. **Parent**: searchDrugs("amoxicillin") → getDrugPrices → getPharmacies(94102) (urgent Rx near SF)
3. **Multi-Rx patient**: getPharmacies(60601) → searchDrugs × 2 (lisinopril, atorvastatin) → getDrugPrices × 2 (cross-pharmacy comparison in Chicago)

**Result:** All 3 operations blocked by PerimeterX CAPTCHA (`#px-captcha` detected on page). No workflow could complete.

**Investigation:**
- `warmSession` retry loop functions correctly: 3 cookie-clear + re-navigate retries per attempt, executor adds 2 more retries on top (12 total navigations per call)
- PerimeterX blocks every attempt regardless of cookie state
- Root cause: Chromium 147 headless (`--headless=new`) exposes `HeadlessChrome/147.0.0.0` in the User-Agent string — this is the primary detection signal. The runtime only overrides UA when explicitly configured in `config.json`
- The warm-session PX mitigation (added 2026-04-17) relies on cookie poisoning being the blocking mechanism; headless fingerprinting is a deeper layer that cookie-clearing cannot resolve
- `pnpm dev verify goodrx` confirms: `bot_blocked 0/3 ops`

**Comparison to 2026-04-17:** Verify passed 3/3 on that date. Either PerimeterX tightened headless detection since then, or the IP/fingerprint was flagged after repeated automated access.

**Blocker:** PerimeterX headless browser detection. Cannot resolve without either (a) UA masking at browser launch, or (b) a non-headless browser path. No code changes made — the extraction logic and spec are sound; this is a bot-detection infrastructure issue.
