# CoinGecko — Progress

## 2026-04-24
- Userflow QA: 3 personas (portfolio tracker, NFT researcher, altcoin hunter) across all 5 ops
- All 5 ops returned 200 — no functional failures
- Added trimming adapter (`adapters/coingecko.ts`) for all 5 operations:
  - **getCoinDetail**: 108KB → ~2.5KB inline (98% reduction) — dropped tickers, localization, multi-currency dicts (USD only), capped description at 2000 chars
  - **getTrending**: 53KB → 10KB (82%) — flattened multi-currency price_change dicts to USD scalar
  - **getMarketData**: 79KB → 13KB (84%) — default per_page 100→25, dropped roi/ath_date/atl_date fields
  - **searchCoins**: 14KB → 5KB (63%) — capped coins to 15, nfts to 10, dropped large image URLs
  - **getPrice**: passthrough (already compact)
- Updated openapi.yaml: added adapter refs for all 5 ops, fixed description schema (object → string)
- Verified: `pnpm build && pnpm dev verify coingecko`

## 2026-04-09
- Polish pass: added `required` arrays to all nested response schemas (image, links, market_data, exchanges, categories, nfts, getMarketData items)
- Fixed stray "Site Internals" heading in DOC.md
- Verified: `pnpm build && pnpm --silent dev verify coingecko`
