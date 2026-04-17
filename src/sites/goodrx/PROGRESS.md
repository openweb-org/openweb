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
