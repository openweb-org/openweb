## 2026-04-09: Initial site package

**What changed:**
- Added 4 operations: searchArticles, getArticle, getStockAnalysis, getEarnings
- Adapter-based with pageFetch (page transport due to heavy bot detection)
- Handles premium-locked ratings, ticker ID resolution, dormant PX captcha cleanup

**Why:**
- New site addition — investment research and analysis platform

**Verification:** All 4 ops PASS via `pnpm dev verify seeking-alpha --browser`
