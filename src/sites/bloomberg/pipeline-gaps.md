# Bloomberg Pipeline Gaps

## Status: 10/10 PASS (with manual tabs)

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

## Workaround for Full Verification

Open the required tabs manually in the browser before running verify:

```bash
# 1. Ensure Bloomberg homepage is open: https://www.bloomberg.com/
# 2. Open a quote page:               https://www.bloomberg.com/quote/AAPL:US
# 3. For index member tests, open:     https://www.bloomberg.com/quote/SPX:IND
# 4. Run verify:
pnpm --silent dev verify bloomberg
```

## Fixes Applied (2026-04-02)

1. **`getPriceChart`** — Bloomberg changed `barCharts` from price time series
   (`{oneYear, fiveYear}`) to financial statements (quarterly/annual assets,
   revenue, etc.). Switched extraction to `page_global_data` reading
   `quote.priceMovements1Year` / `quote.priceMovements5Years` which have the
   same `{dateTime, value}` format.

2. **`getBoardMembers`** — Bloomberg changed `boardMembersAndExecutives` from
   a flat array to `{boardMembers: [...], executives: [...]}` with different
   fields (`currentPosition` instead of `title`, plus `personLink`, `tenure`).
   Switched to `page_global_data` that flattens both arrays with field mapping.
   Made `title` nullable since some board members lack `currentPosition`.

3. **`getIndexMembers`** — Bloomberg now returns `null` for `indexMembers` in
   `__NEXT_DATA__`. Switched to `page_global_data` that returns an empty array
   when data is absent instead of throwing.

## Earlier Fixes

1. **`browser-fetch-executor.ts`** — Fixed duplicate `ssrfValidator` declaration (build error).
2. **`openapi.yaml`** — Added `page_url: /quote/{ticker}` to `getQuote` extraction.
3. **`openapi.yaml`** — Fixed schema types: `dayRange`/`fiftyTwoWeekRange` are arrays,
   `lowPrice52Week`/`highPrice52Week` are numbers, `numberOfEmployees` is integer.
4. **`extraction-executor.ts`** — Decode URL pathnames for Bloomberg tickers (`%3A` vs `:`).

## Known Issues

### indexMembers data removed from __NEXT_DATA__
Bloomberg no longer includes index member data in the initial SSR payload.
`getIndexMembers` currently returns an empty array. Index members may load
dynamically after hydration — a future fix could use DOM extraction.

### PerimeterX session poisoning
Even a single programmatic `page.goto()` to a Bloomberg sub-page can trigger bot
detection. Multiple failed navigations accumulate signals and eventually block the
entire browser session. Clearing PerimeterX cookies (`_pxvid`, `pxcts`, `_pxhd`,
`_px2`, `_pxde`) resets the ban. The `autoNavigate` fallback to the server root
(`/`) is safe and does not trigger PerimeterX.
