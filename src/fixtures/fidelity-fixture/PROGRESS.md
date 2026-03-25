# Fidelity Fixture — Progress

## 2026-03-25: Initial discovery — 10 operations

**What changed:**
- Created fidelity-fixture with 10 operations: getStockQuote, getCompanyProfile, getNewsHeadlines, getMarketIndices, getIndexQuotes, getResearchData, getCompanyLogo, getMutualFundPerformance, getMutualFundSummary, getFundPicks
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md

**Why:**
- Fidelity is a major financial services platform — public market data pages provide stock quotes, company profiles, news, analyst ratings, sector data, and mutual fund research without login
- 7 POST operations on digital.fidelity.com (page transport, CSRF required) + 3 GET operations on fundresearch.fidelity.com (node transport)
- Account/trading/screener endpoints excluded — require full authentication

**Discovery process:**
1. Browsed Fidelity systematically via managed browser: stock quote pages (AAPL, TSLA, MSFT, NVDA, SPY), market overview, news, sectors, mutual fund page (FXAIX), research overview
2. Compiled captured traffic via `pnpm dev compile` — 24 raw operations generated, 8 verified via probe
3. Curated to 10 operations: removed noise (PerimeterX bot detection, LaunchDarkly feature flags, Markit OAuth internal tokens, app initialization, visitor tracking, login-related endpoints, legal disclosures)
4. POST endpoints use page transport (CSRF + bot detection), GET fund endpoints use node transport

**Verification:** GET endpoints verified PASS via node probe. POST endpoints require browser context — verified via page transport.

**Knowledge updates:** None — Fidelity follows standard BFF pattern (Angular frontend → POST API gateway with CSRF). No novel auth or extraction techniques.
