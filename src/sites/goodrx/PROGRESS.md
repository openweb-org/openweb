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

## 2026-04-13 — PerimeterX Mitigation

**Context:** PerimeterX bot detection blocks requests across operations, especially during sequential verify runs where cookies become poisoned.
**Changes:** Added inter-op delay and browser context recovery in `adapters/goodrx-web.ts` — `navigateWithPxRetry` clears cookies and resets to `about:blank` before each navigation attempt, with progressive backoff (1s + attempt * 1s). Adapter `init` also clears cookies if a PX CAPTCHA is detected from prior warm-up.
**Verification:** Sequential operations no longer cascade-fail from poisoned PX state; retry loop recovers within 4 attempts.
