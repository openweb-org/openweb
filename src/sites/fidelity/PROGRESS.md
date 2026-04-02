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
