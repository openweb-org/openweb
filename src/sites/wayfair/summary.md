# Wayfair — Transport Upgrade Summary

## Status: BLOCKED — Bot Detection

PerimeterX + DataDome dual-layer bot protection blocks all automated access. IP banned after probe attempts. Upgrade skipped per sprint rules.

## Current Transport

- **All 3 ops**: page transport + DOM extraction via `wayfair-web.ts` adapter
- `searchProducts`: on-page search bar (type + Enter) → parse product cards from DOM
- `getProductDetail`: navigate to PDP → extract h1, specs, prices, images from DOM
- `getReviews`: navigate to PDP → scroll to reviews → parse review text blocks

## Probe Results (2026-04-11)

### Step 1: Network Probe (partial — from first successful homepage load)

Before IP was banned, one homepage load revealed:

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/federation/graphql` | POST | 200/429 | **Federated GraphQL** — main data API. Heavy rate limiting (many 429s). |
| `/favorites/graphql` | POST | 429 | Favorites-specific GraphQL endpoint. |
| `/a/core_funnel/core_funnel_data/init_session` | GET | 200 | Session initialization. |
| `/a/core_funnel/core_funnel_data/replatformed_footer` | GET | 200 | Footer data. |
| `/api/observability/v1/log` | POST | 200 | Logging/telemetry. |
| `prx.wayfair.com/px/xhr/api/v2/collector` | POST | 200 | PerimeterX telemetry. |
| `api-js.datadome.co/js/` | POST | 200 | DataDome bot detection. |
| `s.wayfair.com/events/single` | POST | 202 | Event tracking (very high volume). |

**Key discovery**: `/federation/graphql` is the internal API. Wayfair uses federated GraphQL for all data. However, even on the homepage, many GraphQL calls returned **429** — aggressive rate limiting.

### Step 2: Fetch Probe — NOT REACHED

IP was banned before fetch probe could run.

### Step 3: Webpack Probe — NOT REACHED

IP was banned before webpack probe could run.

### Step 4: Bot Detection Analysis

Wayfair runs **dual-layer** bot protection:
1. **PerimeterX** (`prx.wayfair.com/px/`) — fingerprints Playwright's `page.goto()`. The existing adapter works around this by using `window.location.href` from `page.evaluate()`.
2. **DataDome** (`api-js.datadome.co`) — secondary bot detection layer. Contributed to IP ban.

Both `page.goto()` and `window.location.href` from a fresh browser session triggered "Access to this page has been denied" after the initial probe. The IP was blocked site-wide.

## Decision: SKIP

Per sprint rules: bot detection blocks probe → document and skip.

### What would need to happen for upgrade

If Wayfair access is restored (IP rotation, CAPTCHA solve, or warm session):

1. **Capture `/federation/graphql` operation names** — the homepage probe showed the endpoint exists and returns data (200s mixed with 429s). Need to capture the specific operation names and variables used on search and product pages.
2. **Test `page.evaluate(fetch)` to `/federation/graphql`** — if fetch from within page context can hit the GraphQL endpoint with proper cookies/headers, this eliminates all DOM parsing.
3. **Test node direct** — unlikely to work given dual-layer bot protection, but worth a quick try with proper headers.
4. **Likely landing point**: `page.evaluate(fetch)` to `/federation/graphql` — stays in browser (bypasses bot detection) but uses structured GraphQL responses instead of fragile DOM parsing.

### Why upgrade matters

The current DOM adapter is extremely fragile:
- `searchProducts` walks up DOM 12 levels to find card containers, parses prices from `$` regex patterns
- `getProductDetail` extracts brand from page title regex, prices from body text regex
- `getReviews` splits review text on "Rated N out of 5 stars." string — any wording change breaks it

The GraphQL API at `/federation/graphql` would provide structured JSON responses, eliminating all of this.

## Rejected Approaches

| Approach | Reason |
|----------|--------|
| `page.goto()` navigation | PerimeterX fingerprints Playwright goto — triggers bot block |
| Node direct to `/federation/graphql` | Dual-layer bot protection (PerimeterX + DataDome) almost certainly blocks node requests |
| Fresh browser session probe | IP was banned after initial probe — all subsequent requests returned "Access Denied" |
