# CoinMarketCap — Progress

## 2026-04-24: Response trimming adapter

**What changed:**
- Created `adapters/coinmarketcap.ts` — trims all 3 ops (getListings, getQuote, getTrending)
- openapi.yaml: wired `x-openweb.adapter` + `transport: node` on each operation, removed always-null listing fields (ath/atl/high24h/low24h)

**Size reduction:**
- getListings (100 items): 135KB → 54KB (60%)
- getListings (10 items): 16KB → 5.4KB (66%)
- getQuote: 49–52KB → ~3KB inline (94%)
- getTrending: trimmed extra dex/platform fields, stays inline

**Trim strategy:**
- getListings: pick spec-declared fields per item, trim quotes to core price/volume/change fields
- getQuote: keep id/name/symbol/slug/category/description/urls/statistics, cap description at 2000 chars, statistics reduced from 57 to 19 fields
- getTrending: pick 8 core fields per item (cryptoId, slug, tokenSymbol, tokenName, priceUsd, volume24h, pricePercentageChange24h, marketCap)

**Verification:** `pnpm --silent dev verify coinmarketcap`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- DOC.md: fixed heading hierarchy under Site Internals (## → ###), added Extraction subsection
- openapi.yaml: added `compiled_at`, ensured `example` on all parameters, `description` on every property, `required` arrays on all objects
- All 3 example files: added `replay_safety: safe_read`, added `response_schema_valid: true` assertion

**Why:**
Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify coinmarketcap`
