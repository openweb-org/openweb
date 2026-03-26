## 2026-03-26: Expand coverage from 3 to 8 ops

**What changed:**
- Added 5 new operations: getCoinDetail, getCoinMarketChart, getTrendingCoins, getGlobalData, getExchanges
- Updated DOC.md with all 8 operations and API architecture notes
- Added test files for all new operations

**Why:**
- Expand CoinGecko coverage to include coin details, historical charts, trending, global stats, and exchanges

**Verification:** API-level — 7/8 PASS (getPrice transient 429 rate limit), all new ops verified

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 verified operations for public crypto market data

**Verification:** spec review only — no new capture or compilation
