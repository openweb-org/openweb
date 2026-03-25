# Redfin

## Overview
Real estate marketplace — search homes for sale, view property details, get automated valuations (Redfin Estimate).

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchHomes | Search homes by city/region | GET /city/{regionId}/{state}/{city} | Extracts JSON-LD `SingleFamilyResidence` + `Product` pairs; ~40 listings per page |
| getPropertyDetails | Get full property detail | GET /{state}/{city}/{address}/home/{propertyId} | Extracts JSON-LD `RealEstateListing`; beds, baths, sqft, year, amenities, photos |
| getRedfinEstimate | Get Redfin Estimate (AVM) | GET /{state}/{city}/{address}/home/{propertyId}/estimate | DOM extraction from `.avmInfo` section; estimate price + comparable sales |

## API Architecture
- **Fully SSR-rendered** — search results and property details are baked into the initial HTML page load, not fetched via XHR/fetch API calls.
- Internal APIs exist at `/stingray/api/*` but are **minor supporting endpoints** only: feature flags (`resolveBouncerFlags`), utilities data (`getUtilitiesData`), comparable rentals, chat. Not the main data source.
- **JSON-LD structured data** (`<script type="application/ld+json">`) is the richest extraction source:
  - Search pages: arrays of `[SingleFamilyResidence, Product]` pairs, one per listing
  - Detail pages: single `Product + RealEstateListing` object with `mainEntity` containing full property info
- Massive `window.g_*` globals (100+ enums) are internal constant mappings — not data.
- Compiler auto-filter removes ALL Redfin API samples as "noise" because the stingray APIs are low-value. Manual fixture creation required.

## Auth
- **No auth required** for all three operations. Public listing data is accessible without login.
- User was logged in during discovery (cookie session), but public data is available to anonymous users.

## Transport
- **`page` transport** — all data comes from rendered pages. Node transport would require rendering the full SSR HTML, and Redfin doesn't expose the listing data via a clean JSON API.
- Any open `www.redfin.com` page of the correct type will match (no `page_url` set; origin-level matching).

## Extraction
- `searchHomes`: `page_global_data` — iterates all `application/ld+json` scripts, extracts `[Residence, Product]` pairs.
- `getPropertyDetails`: `page_global_data` — finds the JSON-LD entry with `@type: ["Product", "RealEstateListing"]`, extracts `mainEntity` details.
- `getRedfinEstimate`: `page_global_data` — finds the AVM section by `data-rf-test-id="avm-section-expandable-preview"` or `.avmInfo` class, parses estimate value and comparable sales from inner text.
- Comparable sales in the estimate section use text parsing (regex) — somewhat fragile if Redfin changes the text format.

## Known Issues
- **No bot detection** — headless Chrome works without issues.
- **DOM-dependent**: JSON-LD structure and AVM section markup may change with Redfin UI updates. JSON-LD uses standard schema.org types so is more stable than CSS selectors.
- **Comparables parsing**: The last comparable sometimes lacks an address (null) when the DOM text format doesn't match the address regex. Schema allows nullable address.
- **Price range truncation**: The comparable price range text includes `$X.XM` format — regex must handle periods in dollar amounts (not treat them as sentence terminators).
