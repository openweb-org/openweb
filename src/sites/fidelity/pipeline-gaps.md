# Fidelity Pipeline Gaps

## Fixed: ssrfValidator not passed through browser-fetch-executor (2026-04-02)

**Symptom:** 7/13 operations fail with `ssrfValidator is not a function`
**Affected operations:** All page-transport ops (getQuote, getMarketSummary, getCompanyProfile, getNewsHeadlines, getIndexQuotes, getResearchData, getCompanyLogo)
**Root cause:** `browser-fetch-executor.ts` passed raw `deps` (with `ssrfValidator: undefined`) to `resolveAuth`, `resolveCsrf`, and `resolveSigning`. The primitives expect `ssrfValidator` as a required function. The `ssrfValidator` fallback (`deps.ssrfValidator ?? validateSSRF`) was resolved at line 151 — after the primitive calls at lines 78, 131, 141.

**Fix:** Same pattern as session-executor.ts (chatgpt fix):
1. Resolve `ssrfValidator` with fallback at top of try block (line 77)
2. Pass `{ ...deps, ssrfValidator }` to all three primitive calls

**Files changed:** `src/runtime/browser-fetch-executor.ts`

## Remaining: page-transport operations require browser

**Status:** 6/13 PASS, 7/13 need browser tab
**Node-transport (PASS):** getFundPerformance, getFundPicks, getFundSummary, listAssetClasses, listFundFamilies, searchFunds
**Page-transport (needs browser):** getQuote, getMarketSummary, getCompanyProfile, getNewsHeadlines, getIndexQuotes, getResearchData, getCompanyLogo

Page-transport ops require a browser with digital.fidelity.com open due to PerimeterX bot detection blocking node transport. These are not spec issues — they work correctly when a browser is available.
