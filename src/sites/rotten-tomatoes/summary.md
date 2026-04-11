# Rotten Tomatoes — Transport Upgrade Summary

## TL;DR

Upgraded all 3 ops from **DOM extraction** (querySelector + waitForSelector) to **node-native HTML parsing** (Node.js fetch + regex). Zero DOM dependency. Verify 3/3 PASS.

## Before → After

| Aspect | Before | After |
|--------|--------|-------|
| Transport tier | DOM parsing (fragile) | Node-native fetch + HTML parse |
| Fetch method | `page.goto()` + `page.evaluate()` on rendered DOM | Node.js native `fetch()` in adapter |
| DOM dependency | `search-page-media-row` selectors, `media-scorecard` selectors, `[data-qa=synopsis-value]`, LD+JSON script tag | None — parses raw SSR HTML |
| Browser dependency | Full page render required (CSS, JS, web components) | Browser launched by executor (adapter interface) but unused for fetching |
| Bot detection | None | None — confirmed node fetch returns full SSR HTML |
| Speed | ~5-10s (full page load + render + wait) | ~1-2s (single HTTP fetch + regex parse) |

## Probe Process

### Step 1: Network Sniffing
Navigated to search and detail pages, captured all JSON API calls:
- `/api/private/v1.0/wordpress/header-mobile` — nav menu only
- `/cnapi/modules/arti-suggestions` — AI chatbot prompts
- `/cnapi/videos?emsId=...` — video metadata
- `/cnapi/modules/discovery-sidebar/movie/...` — sidebar recommendations
- `/napi/preferences/themes` — theme token
- `/napi/device/inspection` — device info

**No search API or movie data API found.** All content APIs (search, movie detail, scores) are SSR-only.

### Step 2: Fetch Patching
```
window.fetch.toString().length = 34  (native)
```
Fetch is not monkey-patched. No client-side signing.

### Step 3: Webpack Detection
```
no webpack found
```
No webpack module system. No injectable service classes.

### Step 4: Global Variables
- `__RT__` — feature flags only (adsCarouselHP, etc.), no movie data
- `dataLayer` — GTM analytics, has `emsID` but not useful for extraction
- `RTLocals` — empty object

### Step 5: SSR HTML Probing (Key Discovery)
Tested both `page.evaluate(fetch)` and pure Node.js `fetch()`:

**Search page** (`/search?search=inception`):
- Returns 139KB HTML with `search-page-media-row` elements
- All data in element attributes: `tomatometer-score`, `release-year`, `cast`, `tomatometer-is-certified`, `tomatometer-sentiment`
- Movie section isolated by `<search-page-result type="movie">`
- Links use absolute URLs

**Detail page** (`/m/inception`):
- Returns 206KB HTML with LD+JSON (schema.org Movie) and `media-scorecard`
- LD+JSON has: name, actor, director, contentRating, dateCreated, genre, description, image, aggregateRating
- Scorecard slots in HTML: `slot="critics-score"` → `87%`, `slot="audience-score"` → `91%`
- Score icons: `<score-icon-critics certified sentiment="positive">`, `<score-icon-audience sentiment="POSITIVE">`
- Synopsis: `<rt-text data-qa="synopsis-value">`
- Review count: `<rt-link slot="critics-reviews">363 Reviews</rt-link>`

**Node fetch works identically to browser fetch** — no bot detection, no Akamai/DataDome/PerimeterX.

### Step 6: Decision
```
Has SSR HTML with all data + No bot detection + No auth
  → Node-native fetch + HTML regex parsing (highest stability)
```

## Rejected Approaches

| Approach | Why rejected |
|----------|-------------|
| Keep DOM extraction | Fragile — depends on web component rendering, CSS selectors |
| `page.evaluate(fetch)` | Works, but still requires browser overhead; node fetch is sufficient |
| API intercept | No API endpoints found — all data is SSR HTML |
| Webpack module walk | No webpack on this site |
| Pure `transport: node` without adapter | Runtime expects JSON from node transport; RT returns HTML requiring custom parsing |

## Implementation

Rewrote `rotten-tomatoes-web.ts` adapter:
- Replaced all `page.goto()` + `page.evaluate(() => document.querySelector(...))` with `fetch()` + regex
- `fetchHtml()` — plain Node.js fetch with browser UA
- `searchMovies` — regex extracts `search-page-media-row` attributes from movie section
- `getMovieDetail` — regex parses LD+JSON + scorecard HTML
- `getTomatoMeter` — regex parses scorecard + LD+JSON aggregateRating
- HTML entity decoding for synopsis text

`Page` parameter required by adapter interface but unused — all operations are pure functions over HTTP responses.

## Verification

```
✓ rotten-tomatoes: PASS (3/3 ops)
  ✓ getMovieDetail: PASS
  ✓ getTomatoMeter: PASS
  ✓ searchMovies: PASS
```

All responses match the OpenAPI schema. Data quality verified against live site.

## Remaining Fragilities

- **HTML structure**: element attribute names (`tomatometer-score`, `release-year`) could change. More stable than CSS selectors but not zero-risk.
- **LD+JSON schema**: schema.org Movie format is standardized, unlikely to change.
- **Browser overhead**: adapter interface still requires a Page object, so the executor launches a browser even though it's unused. A future runtime change to support browser-free adapters would eliminate this.
- **No pagination**: search returns only the first page. No pagination API was discovered during probing.
