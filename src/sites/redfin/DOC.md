# Redfin

## Overview
Real estate marketplace — search homes for sale, view property details, get automated valuations, browse listing photos, review price history, check local market insights, and find similar nearby homes.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchHomes | Search homes by city/region | GET /city/{regionId}/{state}/{city} | Extracts JSON-LD `SingleFamilyResidence` + `Product` pairs; ~40 listings per page |
| getPropertyDetails | Get full property detail | GET /{state}/{city}/{address}/home/{propertyId} | Extracts JSON-LD `RealEstateListing`; beds, baths, sqft, year, amenities, photos |
| getRedfinEstimate | Get Redfin Estimate (AVM) | GET …/estimate | DOM extraction from AVM section; estimate price + comparable sales |
| getListingPhotos | Get all listing photos | GET …/photos | JSON-LD `ImageObject` entries with url, width, height; typically 20-30 photos |
| getPriceHistory | Get sale/listing history | GET …/history | DOM extraction from `.PropertyHistory`; date, event type, price, price/sqft |
| getMarketInsights | Get local market conditions | GET …/market | DOM extraction from `market-insights` section; market type, offer trends, days on market |
| getSimilarHomes | Get nearby similar homes | GET …/similar | DOM extraction from `.SimilarHomeCardReact` cards; price, beds, baths, sqft, address, URL |

## API Architecture
- **Fully SSR-rendered** — search results and property details are baked into the initial HTML page load, not fetched via XHR/fetch API calls.
- Internal APIs exist at `/stingray/api/*` but are **minor supporting endpoints** only: feature flags (`resolveBouncerFlags`), utilities data (`getUtilitiesData`), comparable rentals, chat. Not the main data source.
- **JSON-LD structured data** (`<script type="application/ld+json">`) is the richest extraction source:
  - Search pages: arrays of `[SingleFamilyResidence, Product]` pairs, one per listing
  - Detail pages: single `Product + RealEstateListing` object with `mainEntity` containing full property info, including `ImageObject` entries for all photos
- Massive `window.g_*` globals (100+ enums) are internal constant mappings — not data.
- Compiler auto-filter removes ALL Redfin API samples as "noise" because the stingray APIs are low-value. Manual fixture creation required.

## Auth
- **No auth required** for all operations. Public listing data is accessible without login.

## Transport
- **`page` transport** — all data comes from rendered pages. Node transport would require rendering the full SSR HTML, and Redfin doesn't expose the listing data via a clean JSON API.
- Any open `www.redfin.com` page of the correct type will match (no `page_url` set; origin-level matching).

## Extraction
- `searchHomes`: `page_global_data` — iterates all `application/ld+json` scripts, extracts `[Residence, Product]` pairs.
- `getPropertyDetails`: `page_global_data` — finds the JSON-LD entry with `@type: ["Product", "RealEstateListing"]`, extracts `mainEntity` details.
- `getRedfinEstimate`: DOM text parsing — finds the AVM section by `data-rf-test-id="avm-section-expandable-preview"` or `.avmInfo` class, parses estimate value and comparable sales.
- `getListingPhotos`: `page_global_data` — extracts `ImageObject` entries from JSON-LD `mainEntity.image` array; each has url, width, height.
- `getPriceHistory`: DOM text parsing — finds `.PropertyHistory` section, parses the "Sale History" tab content line-by-line for date/event/source/price/price-per-sqft.
- `getMarketInsights`: DOM text parsing — finds `[data-rf-test-id="market-insights-expandable-preview"]`, extracts neighborhood name, market type (seller/buyer), offer insights, list-to-sale ratio, average days on market.
- `getSimilarHomes`: DOM text parsing — finds `[data-rf-test-id="similarsSection"]`, iterates `.SimilarHomeCardReact` cards extracting price, beds, baths, sqft, address, URL from innerText lines.

## Known Issues
- **No bot detection** — headless Chrome works without issues.
- **DOM-dependent**: JSON-LD structure and AVM section markup may change with Redfin UI updates. JSON-LD uses standard schema.org types so is more stable than CSS selectors.
- **Comparables parsing**: The last comparable sometimes lacks an address (null) when the DOM text format doesn't match the address regex. Schema allows nullable address.
- **Price range truncation**: The comparable price range text includes `$X.XM` format — regex must handle periods in dollar amounts.
- **Price history limited to visible tab**: Only the active "Sale History" tab content is extracted. "Tax History" requires a tab switch to load.
- **Similar homes count varies**: The section typically shows 4-8 homes, varying by property and market.
