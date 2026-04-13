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
- **Adapter-based extraction**: All operations use the `goodrx-web` adapter with DOM parsing and JSON-LD
- **PerimeterX bot detection**: Blocks direct HTTP; browser-only access via `transport: page`

## Auth
No auth required. All operations access public drug pricing data.

## Transport
- `transport: page` — PerimeterX blocks all node/direct HTTP requests
- Homepage warm-up required: navigate to goodrx.com before drug pages to build PerimeterX cookies
- Adapter: `adapters/goodrx-web.ts`

## Extraction
- **searchDrugs**: `page.evaluate` fetch to `/api/autocomplete` endpoint from page context, with DOM link fallback
- **getDrugPrices**: JSON-LD `@type: Drug` for drug name + DOM `<li>` parsing for pharmacy/price pairs
- **getPharmacies**: DOM link extraction from `a[href*="/pharmacy/"]` elements

## Known Issues
- **Empty results in headless mode**: All ops verify (schema-valid) but return empty arrays. PerimeterX likely blocks headless Playwright; DOM selectors may also be outdated.
- **PerimeterX bot detection**: Blocks direct HTTP and poisons cookies during sequential operations. Mitigated via inter-op delay + browser context recovery: adapter clears cookies, resets to `about:blank`, and retries with progressive backoff (up to 4 attempts). Adapter `init` also detects and clears poisoned PX state from prior warm-up.
- **Location-dependent pricing**: Pharmacy prices vary by detected geolocation.
- **DOM structure changes**: Adapter parses DOM elements directly — GoodRx UI changes may break extraction.
