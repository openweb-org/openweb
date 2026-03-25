# GoodRx

## Overview
Drug price comparison platform. Compare prescription prices across pharmacies, get coupon prices, drug information, dosage pricing, FAQ, and health articles via GoodRx's DOM/JSON-LD extraction and GraphQL API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getDrugPrices | pharmacy price comparison | GET /{slug} | coupon prices at CVS, Walgreens, Walmart, Costco, etc. |
| getDrugInfo | drug metadata | GET /{slug} | name, drug class, description, warnings, dosage form from JSON-LD |
| getDrugOffers | pricing by form/dosage | GET /{slug} | JSON-LD offers with prices per form, strength, membership tier |
| getDrugPricesByDosage | dosage pricing table | GET /{slug} | retail vs GoodRx price per dosage/quantity combination |
| getHomeDeliveryPrices | home delivery prices | GET /{slug} | mail-order pharmacy options and prices |
| getDrugDescription | drug uses/description | GET /{slug}/what-is | MedicalWebPage: description, author, publication dates |
| getDrugFAQ | drug FAQ | GET /{slug}/what-is | FAQPage: common Q&A about the medication |
| getDrugArticles | health articles | GraphQL | articles about a drug with authors, thumbnails, read time |
| getPopularDrugs | trending drugs | GraphQL | most popular/searched drugs on GoodRx |
| getDrugConcept | drug concept/lowest price | GraphQL | recommended form/dosage config with lowest available price |

## API Architecture
- **Next.js App Router with RSC**: React Server Components stream data — no classic `__NEXT_DATA__`
- **GraphQL API**: `graph.goodrx.com/` serves supplementary data (articles, popular drugs, drug concepts)
- **DOM/JSON-LD**: Drug pricing, drug metadata, offers, FAQ, and descriptions are embedded in page HTML as JSON-LD structured data and DOM elements
- **PerimeterX bot detection**: Direct HTTP blocked; browser-only access (`transport: page`)
- Drug pricing pages embed Schema.org `Drug` type with `offers` array in JSON-LD
- Drug info pages embed `MedicalWebPage`, `FAQPage`, and `Drug` JSON-LD types

## Auth
- No auth needed for all 10 included operations
- `requires_auth: false`
- GraphQL API requires PerimeterX cookies and session tokens (obtained automatically in browser context)

## Transport
- `transport: page` — browser fetch only (PerimeterX blocks node/direct HTTP)
- Bot detection: PerimeterX (px-cloud.net) — direct navigation to drug pages without homepage warm-up triggers "Access denied"
- Navigate to homepage first, then to drug pages (builds PerimeterX cookies)
- GraphQL headers: `apollographql-client-name: next-web-rcc`, `x-grx-tenant: gdrx`

## Extraction
- **Adapter-based**: All operations use the `goodrx-web` adapter
- DOM extraction for pharmacy prices (LI elements with pharmacy name + price)
- JSON-LD extraction for drug metadata (Drug, MedicalWebPage, FAQPage schemas)
- GraphQL fetch from page context for articles, popular drugs, and drug concepts
- Dosage pricing from tab-delimited text in page body

## Known Issues
- **PerimeterX warm-up**: Must visit homepage first before drug pages. Direct navigation to `/{slug}` may trigger "Access denied".
- **Location-dependent pricing**: Pharmacy prices vary by user location (GoodRx uses geolocation). Prices shown are for the detected location.
- **GraphQL session tokens**: The `x-grx-session` JWT expires. Long-running sessions may need page refresh.
- **Dosage table format**: Tab-delimited text parsing — may break if GoodRx changes DOM structure.
- **Home delivery section**: Depends on `aria-label="List of home delivery prices"` attribute.
