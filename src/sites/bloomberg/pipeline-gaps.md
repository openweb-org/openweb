# Bloomberg Pipeline Gaps

## Status: 4/10 PASS (automated), 10/10 PASS (with manual tabs)

## PerimeterX Blocks Programmatic Navigation

**Problem:** Bloomberg uses PerimeterX bot detection. All programmatic navigation
(`page.goto()`, `window.location.href`, `next.router.push()`, in-page `fetch()`)
returns 403 "Are you a robot?". Even Next.js data routes (`/_next/data/`) are blocked.

**Impact:** 6 quote-page operations cannot auto-navigate to `/quote/{ticker}`.
They need the user to manually open the quote page in the browser before running.

**Affected operations:**
- `getQuote` — needs `/quote/{ticker}` tab
- `getCompanyProfile` — needs `/quote/{ticker}` tab
- `getPriceChart` — needs `/quote/{ticker}` tab
- `getPriceMovements` — needs `/quote/{ticker}` tab
- `getBoardMembers` — needs `/quote/{ticker}` tab
- `getIndexMembers` — needs `/quote/{ticker}` tab (e.g. `/quote/SPX:IND`)

**Working operations (homepage-only):**
- `getTickerBar` — extracts from homepage `/`
- `getNewsHeadlines` — extracts from homepage `/`
- `getLatestNews` — extracts from homepage `/`
- `searchBloomberg` — extracts from homepage `/`

**Mitigation:** The extraction executor caches blocked origins after the first 403,
preventing repeated navigation attempts that would poison the PerimeterX session
cookies and break working homepage operations.

## Workaround for Full Verification

Open the required tabs manually in the browser before running verify:

```bash
# 1. Ensure Bloomberg homepage is open: https://www.bloomberg.com/
# 2. Open a quote page:               https://www.bloomberg.com/quote/AAPL:US
# 3. For index member tests, open:     https://www.bloomberg.com/quote/SPX:IND
# 4. Run verify:
pnpm --silent dev verify bloomberg
```

## Fixes Applied

1. **`browser-fetch-executor.ts`** — Fixed duplicate `ssrfValidator` declaration (build error).
2. **`openapi.yaml`** — Added `page_url: /quote/{ticker}` to `getQuote` extraction.
   Without it, the system falls back to origin-level page matching and runs extraction
   on the homepage (wrong `__NEXT_DATA__`).
3. **`extraction-executor.ts`** — Three improvements:
   - Auto-navigate to `targetPageUrl` (not just server root) when no matching page exists.
     This fixes extraction for non-PerimeterX SSR sites.
   - Check navigation response status (close page on 403/5xx instead of extracting from error pages).
   - Cache blocked origins to prevent repeated failed navigations from poisoning the session.
   - Decode URL pathnames before comparison (`%3A` vs `:` in tickers).

## Root Cause

Bloomberg's PerimeterX is session-aware. Even a single `page.goto()` to a new tab
can trigger bot detection. Multiple failed navigations accumulate signals and
eventually block the entire browser session (all domains under `*.bloomberg.com`).
Clearing PerimeterX cookies (`_pxvid`, `pxcts`, `_pxhd`, `_px2`, `_pxde`) resets the ban.
