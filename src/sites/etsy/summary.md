# Etsy — Transport Upgrade Summary

## Probe Date: 2026-04-11

## Current State
- **Transport:** page (adapter-based)
- **Ops:** searchListings, getListingDetail, getReviews, getShop (4 ops)
- **Adapter:** LD+JSON extraction (listing, reviews, shop) + DOM extraction (search results, photos, sales count)

## Probe Results

### Step 1: Network Capture
Navigated to search, listing, and shop pages. Scrolled search page to trigger lazy-load.
**Result: Zero API/XHR/fetch calls detected.** Etsy serves everything server-side rendered. No `/api/`, no GraphQL, no JSON endpoints, no AJAX — nothing.

### Step 2: Fetch Probe
`window.fetch.toString().length = 34` — native, not patched. No auto-signing.

### Step 3: Webpack Probe
No `webpackChunk`, no `__LOADABLE_LOADED_CHUNKS__`, no webpack-related window keys. Etsy does not use webpack module federation or expose a require hook.

### Step 4: Global Variables
No `__NEXT_DATA__`, `__INITIAL_STATE__`, `__APOLLO_STATE__`, or any Etsy-specific SSR globals. No dunder objects of interest on `window`.

### Step 5: Node Direct Fetch
`GET https://www.etsy.com/search?q=pottery` → **403 Forbidden** with bot check. No LD+JSON, no `data-listing-id` attributes. Cloudflare + PerimeterX + DataDome fully block non-browser requests.

## Decision: No Upgrade

Etsy is a **pure SSR site** with no discoverable internal APIs:
- No client-side data fetching — all data is in the initial HTML
- No webpack to walk for internal service modules
- Node direct is blocked by triple-layer bot detection (Cloudflare + PerimeterX + DataDome)
- `page.evaluate(fetch(...))` has nothing to fetch — there are no API endpoints

**The current LD+JSON + DOM approach is already the optimal transport for Etsy.**

### Stability Assessment
| Op | Extraction | Fragility | Notes |
|----|-----------|-----------|-------|
| searchListings | DOM (`a[data-listing-id]`) | Medium | Selector is a semantic data attribute, not a CSS class — reasonably stable |
| getListingDetail | LD+JSON `Product` + DOM for photos | Low | schema.org is a standard; photo selector uses content domain pattern |
| getReviews | LD+JSON `Product.review` | Low | schema.org standard, ~4 reviews only |
| getShop | LD+JSON `Organization` + DOM for sales/years | Low-Medium | LD+JSON is stable; DOM regex for sales/years is the weakest link |

### What Would Change This
- Etsy migrating to a SPA framework (React/Next.js) with client-side data fetching → intercept or API upgrade possible
- Etsy exposing a public/semi-public API → node direct
- Bot detection relaxing → node + HTML parse (unlikely)

## Rejected Approaches
| Approach | Why Rejected |
|----------|-------------|
| Node direct | 403 — triple bot detection layer |
| API intercept | No APIs to intercept |
| page.evaluate(fetch) | No API endpoints to call |
| Webpack module walk | No webpack |
| SSR global extraction | No globals |
