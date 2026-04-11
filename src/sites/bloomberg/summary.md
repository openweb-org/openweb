# Bloomberg — Transport Upgrade Summary

## Probe Date: 2026-04-11

## Current State

Bloomberg has 7 ops, all using `page` transport with `ssr_next_data` / `page_global_data` extraction from `__NEXT_DATA__`. No adapter. PerimeterX bot detection blocks direct HTTP.

| Op | Extraction | Page URL |
|---|---|---|
| getTickerBar | `ssr_next_data` path | `/` (homepage) |
| getNewsHeadlines | `page_global_data` expression | `/` (homepage) |
| getLatestNews | `page_global_data` expression | `/` (homepage) |
| searchBloomberg | `page_global_data` expression | `/search` |
| getCompanyProfile | `page_global_data` expression | `/profile/company/{ticker}` |
| getStockChart | `page_global_data` expression | `/quote/{ticker}` |
| getMarketOverview | `page_global_data` expression | `/markets` |

## Probe Results

### Step 1: Network Traffic (Homepage)

Homepage loads successfully. Discovered Bloomberg's internal REST APIs firing during page lifecycle:

- **`/lineup-next/api/topicsStories?topicIds=...&storyLimit=5`** — stories by topic
- **`/lineup-next/api/stories/{id1},{id2},...`** — story details by IDs
- **`/lineup-next/api/liveblog/{id}`** — liveblog data
- **`/lineup-next/api/newsletter/markets-news-alerts`** — newsletter metadata
- **`/tophat/api/spotlights?site=bcom`** — spotlights/highlights (returned `{"spotlights":[]}`)
- **`personalization.bloomberg.com/user/recommendations/tpr`** — topic recs
- **`login.bloomberg.com/user-info`** — user info
- **`coordinator.cm.bloomberg.com/coordination`** — paywall/coordination flags

**Key insight:** The `lineup-next/api/*` endpoints return JSON 200 when called by the page's own JavaScript. These are Bloomberg's internal Next.js API layer for content.

### Step 2: Fetch Patching

```
window.fetch.toString().length = 296
```

Source: NewRelic APM instrumentation (`r.emit(i+"before-start",...)`). **NOT auto-signing.** Just monitoring — useless for transport upgrade.

### Step 3: Webpack Modules

```
webpack found: 1322 modules
```

Next.js webpack chunks. No heavy service class / internal API client pattern (unlike Telegram's GramJS). Not worth walking.

### Step 4: `__NEXT_DATA__` Availability

Homepage `__NEXT_DATA__` is **8.3 MB** with structure:

```
initialState:
  - curation
  - tophatSnippet
  - breakingNews
  - navMenuItems
  - modulesById (60+ editorial modules with stories)
  - pageData
  - tickerBar
```

All homepage ops extract from this successfully.

### Step 5: Global Objects

- `__bloomberg__` — A/B testing (Abba), ad metrics, paywall config, regUI. No data APIs.
- `__STATSIG__`, `__SDKCONFIG__` — feature flags.
- `dataLayer` — Google Tag Manager. No data APIs.

### Step 6: Sub-Page Access — ALL BLOCKED

**Every non-homepage access returns 403 "Are you a robot?" (PerimeterX):**

| Target | Method | Result |
|---|---|---|
| `/quote/AAPL:US` | `page.goto()` | 403 |
| `/search?query=apple` | `page.goto()` | 403 |
| `/markets` | `page.goto()` | 403 (no API traffic) |
| `/quote/AAPL:US` | `page.evaluate(fetch)` | 403 |
| `/markets` | `page.evaluate(fetch)` | 403 |
| `/profile/company/AAPL:US` | `page.evaluate(fetch)` | 403 |
| `/_next/data/{buildId}/index.json` | `page.evaluate(fetch)` | 403 |
| `/_next/data/{buildId}/markets.json` | `page.evaluate(fetch)` | 403 |
| `/_next/data/{buildId}/quote/AAPL:US.json` | `page.evaluate(fetch)` | 403 |
| `/lineup-next/api/topicsStories` | `page.evaluate(fetch)` | 403 |
| `/lineup-next/api/stories/{ids}` | `page.evaluate(fetch)` | 403 |
| `/lineup-next/api/liveblog/{id}` | `page.evaluate(fetch)` | 403 |
| `/lineup-next/api/search?query=apple` | `page.evaluate(fetch)` | 403 |
| `/api/search?query=apple` | `page.evaluate(fetch)` | 403 |
| `/search/api?query=apple` | `page.evaluate(fetch)` | 403 |

**PerimeterX fingerprints every request**, including `page.evaluate(fetch)` calls. Only requests from Bloomberg's own bundled JavaScript pass — any request we initiate (even from within the page context) gets blocked.

### Step 7: Next.js Route Discovery

From `__BUILD_MANIFEST.sortedPages`:
```
/, /_app, /_error, /app, /app/page/null, /app/page/[pageId],
/author/phoenix/[authorType]/[authorId]/[authorName],
/curation/page/[pageId], /latest, /latest/[recordId],
/magazine-phx/[brand]/[magazineId], /modules/id/[id]/page/[pageId],
/playground, /reader, /responsible-disclosure, /sitemap,
/unsubscribed, /your-news
```

No separate API routes exposed. All content served via SSR (getServerSideProps).

## Decision: No Upgrade — Current Approach is Optimal

**For homepage ops (getTickerBar, getNewsHeadlines, getLatestNews):**
- `ssr_next_data` and `page_global_data` from `__NEXT_DATA__` is the most stable available transport.
- The `lineup-next/api/*` endpoints exist but are unreachable from our code (PerimeterX blocks all non-app-originated requests).
- No node alternative — PerimeterX blocks all direct HTTP.

**For sub-page ops (searchBloomberg, getCompanyProfile, getStockChart, getMarketOverview):**
- PerimeterX blocks all sub-page access (both navigation and fetch).
- These ops only work if the user already has the page open in their browser.
- No transport upgrade can fix this — it's a bot detection problem, not a transport problem.

**Why not intercept?**
- `lineup-next/api/*` calls during homepage load return stories, but they're triggered by Bloomberg's own code and we can't control which data they fetch.
- Sub-page intercept is impossible — we can't navigate to sub-pages.

**Why not webpack walk?**
- 1322 modules is a standard Next.js bundle, not a heavy SPA like Telegram. No internal API client or service class to exploit.

**Why not page.evaluate(fetch)?**
- PerimeterX blocks all fetch requests we initiate, even from within the page context. Bloomberg's bot detection fingerprints the call stack or request origin.

## Rejected Approaches

| Approach | Why Rejected |
|---|---|
| Node direct | PerimeterX blocks all node HTTP (no browser fingerprint) |
| page.evaluate(fetch) | PerimeterX blocks (request origin fingerprinting) |
| _next/data JSON endpoints | 403 from all contexts |
| lineup-next/api intercept | Only works during page's own lifecycle; can't trigger |
| Webpack module walk | No useful API client in Next.js bundle |
| SPA client-side navigation | Attempted but blocked during probe (PerimeterX activated, captcha triggered) |

## Outcome

**Transport upgrade: BLOCKED by PerimeterX.** No viable alternative transport discovered. Current `ssr_next_data` + `page_global_data` extraction is the best available approach.

Homepage ops (getTickerBar, getNewsHeadlines, getLatestNews) work reliably. Sub-page ops require the user to have the target page already open — this is a known limitation documented in DOC.md.

**PerimeterX aggressiveness level: Extreme.** Bloomberg's PerimeterX not only blocks node HTTP and page.goto() to sub-pages, but also blocks `page.evaluate(fetch())` to Bloomberg's own same-origin API endpoints. This is the most aggressive bot detection encountered in the transport upgrade sprint.
