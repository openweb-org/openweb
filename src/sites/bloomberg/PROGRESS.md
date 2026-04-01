## 2026-04-01: Fresh rediscovery — 10 operations via SSR extraction

**What changed:**
- Rediscovered Bloomberg from scratch after prior package was deleted
- 10 operations: getTickerBar, getNewsHeadlines, getQuote, getCompanyProfile, getPriceChart, getPriceMovements, getBoardMembers, getIndexMembers, getLatestNews, searchBloomberg
- All operations use page transport with ssr_next_data or page_global_data extraction
- No auth required — all public content

**Why:**
- Prior package deleted during batch site cleanup; recreating fresh with same proven extraction patterns
- Bloomberg is an SSR-only site (PerimeterX blocks node transport) — auto-compile produced 53 noise operations from internal APIs; manual curation reduced to 10 focused operations

**Verification:** Runtime verify with browser, spec standards, doc template
