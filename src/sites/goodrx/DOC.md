# GoodRx

## Overview
Drug price comparison platform. Compare prescription drug prices across pharmacies and find nearby pharmacies.

## Workflows

### Find drug prices
1. `searchDrugs(query)` → pick drug → `slug`
2. `getDrugPrices(slug)` → pharmacy prices

### Find pharmacies near me
1. `getPharmacies(zipCode?)` → list of pharmacy chains with URLs

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchDrugs | search for a drug | query | name, url | entry point; autocomplete results |
| getDrugPrices | compare prices across pharmacies | slug ← searchDrugs | drugName, pharmacy, price | coupon prices at CVS, Walgreens, etc. |
| getPharmacies | find nearby pharmacies | zipCode (optional) | name, slug, url | entry point; defaults to browser geolocation |

## Quick Start

```bash
# Search for a drug
openweb goodrx exec searchDrugs '{"query":"metformin"}'

# Get drug prices at pharmacies
openweb goodrx exec getDrugPrices '{"slug":"metformin"}'

# Find nearby pharmacies
openweb goodrx exec getPharmacies '{}'

# Find pharmacies by ZIP code
openweb goodrx exec getPharmacies '{"zipCode":"90210"}'
```

---

## Site Internals

## API Architecture
- **Next.js App Router with RSC**: Data is server-rendered in DOM and JSON-LD — no classic XHR/fetch JSON APIs
- **Spec-only extraction**: All operations use the `page_global_data` extraction primitive with inline JS expressions (no custom adapter)
- **PerimeterX bot detection**: Blocks direct HTTP; browser-only access via `transport: page`

## Auth
No auth required. All operations access public drug pricing data.

## Transport
- `transport: page` — PerimeterX blocks all node/direct HTTP requests (403 on node fetch)
- Server-level `page_plan: { warm: true }` runs `warmSession()` on first navigation; runtime now detects PerimeterX blocks post-warm and clears cookies + retries (default 3 attempts, linear backoff)
- **No adapter** — `adapters/goodrx-web.ts` deleted in the Phase-4 normalize-adapter migration
- **No `__NEXT_DATA__`**: Site uses Next.js App Router (RSC), not Pages Router. `_next/` assets present but no `__NEXT_DATA__` script tag or `window.__NEXT_DATA__` global
- **Node transport not viable**: PerimeterX returns 403 on direct HTTP

## Extraction
All three operations use `extraction.type: page_global_data` with an inline expression that runs in the navigated page's context:
- **searchDrugs**: navigates to `/search?query={query}`, scans `a[href]` for drug-slug links and filters by query substring
- **getDrugPrices**: navigates to `/{slug}`, parses `script[type="application/ld+json"]` for `@type: Drug` (drug name) and walks `<li>` elements for pharmacy / `$X.XX` price pairs
- **getPharmacies**: navigates to `/pharmacy-near-me`, extracts pharmacy chains from `a[href*="/pharmacy/"]` links

`page_global_data` expressions cannot call `fetch()` (blocked by `evaluatePageExpression`), so the legacy `/api/autocomplete` JSON path was dropped — the DOM-link scan covers the primary signal.

## Known Issues
- **PerimeterX bot detection**: Blocks direct HTTP and may issue press-and-hold CAPTCHAs on cold sessions. Mitigated at the runtime level: `warmSession` detects `#px-captcha` / "Access Denied" titles after the warm delay, clears cookies, and re-navigates with backoff (default 3 retries). No site-specific code required.
- **Location-dependent pricing**: Pharmacy prices vary by detected geolocation.
- **DOM structure changes**: Expressions parse DOM elements directly — GoodRx UI changes may break extraction. Update the `expression` body in `openapi.yaml`.
