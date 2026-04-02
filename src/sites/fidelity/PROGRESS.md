## 2026-04-02: Adapter fix — 13/13 PASS

**What changed:**
- Created `adapters/fidelity-api.ts` — navigates to `/research/quote-and-research/`, fetches CSRF token (`csrfToken` field), calls APIs via `page.evaluate(fetch)` with `X-CSRF-TOKEN` header
- Added `adapter: { name: fidelity-api, operation: <op> }` to all 7 page-transport operations in openapi.yaml
- Fixed CSRF extract field: `csrf` → `csrfToken` (matches actual API response)
- Fixed `http-executor.ts` adapter path: create fresh page when `autoNavigate` fails (adapter handles its own navigation)

**Why:**
- `digital.fidelity.com/` auto-navigate fails in `findPageForOrigin` (redirect mismatch), blocking all 7 page-transport ops with "no browser tab open"
- `browser-fetch-executor` CSRF resolution hits ssrfValidator bug — adapter bypasses this entirely
- Same fix pattern as google-search/booking/redfin: adapter does `page.goto()` + extraction

**Verification:** 13/13 PASS — all operations verified via `pnpm dev verify fidelity`

## 2026-04-02: Rediscovery — 13 operations (6 verified)

**What changed:**
- Full rediscovery from scratch (prior package deleted from worktree)
- Captured traffic via SPA navigation on digital.fidelity.com and fundresearch.fidelity.com
- 13 operations: 7 page-transport (digital.fidelity.com), 6 node-transport (fundresearch.fidelity.com)
- Renamed operations to match user targets: getQuote, getMarketSummary, searchFunds
- Added fund-screener operations: searchFunds, listAssetClasses, listFundFamilies
- Kept prior ops: getQuote, getMarketSummary, getCompanyProfile, getNewsHeadlines, getIndexQuotes, getResearchData, getCompanyLogo, getFundPicks, getFundPerformance, getFundSummary

**Why:**
- Prior package was deleted; user requested fresh discovery targeting getQuote, getMarketSummary, searchFunds, getPortfolio
- getPortfolio requires login (not captured); all other targets covered
- searchFunds added via fund-screener POST API discovered during capture

**Verification:** 6/13 PASS (all node-transport fundresearch.fidelity.com ops). Page-transport ops (digital.fidelity.com) fail with ssrfValidator bug in browser-fetch-executor CSRF resolution — runtime issue, not spec issue.
