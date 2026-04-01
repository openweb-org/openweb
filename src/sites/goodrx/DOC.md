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

## Known Issues
- **PerimeterX warm-up**: Adapter navigates to homepage first before drug pages. Direct navigation may trigger blocks.
- **Location-dependent pricing**: Pharmacy prices vary by detected geolocation.
- **Search input visibility**: Homepage search input may be hidden behind overlays; adapter uses Playwright click/fill.
- **DOM structure changes**: Adapter parses DOM elements directly — GoodRx UI changes may break extraction.
