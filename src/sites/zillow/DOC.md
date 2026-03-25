# Zillow

## Overview
Real estate marketplace (e-commerce archetype). Search homes by location, view property details, check price/tax history. **Currently blocked** — PerimeterX bot detection prevents all access.

## Operations
No fixture compiled. Target operations:

| Operation | Intent | Endpoint | Status |
|-----------|--------|----------|--------|
| searchHomes | search homes by location/filters | `PUT /search/GetSearchPageState.htm` | blocked |
| getPropertyDetail | property details by zpid | `/homedetails/{address}/{zpid}_zpid/` | blocked |
| getPriceHistory | price/tax history for property | `/graphql` or `/zg-graph` | blocked |

## API Architecture
- **Search**: REST — `PUT /search/GetSearchPageState.htm` with JSON body containing `searchQueryState` (map bounds, region selection, filters) and `wants` (result types: `listResults`, `mapResults`).
- **Property detail**: SSR HTML page at `/homedetails/` path. Likely uses embedded JSON (unknown if `__NEXT_DATA__` or custom script tag — could not inspect).
- **GraphQL**: Two endpoints — `/graphql` and `/zg-graph`. Used for enrichment queries (price history, tax records, neighborhood data). Disallowed in `robots.txt`.
- **Autocomplete**: `GET /autocomplete/v3/suggestions?q={query}&resultTypes=allSuggestions`
- **Domain**: All on `www.zillow.com`. Static assets on `www.zillowstatic.com` (CDN, no PX).

## Auth
Unknown — could not get past bot detection to inspect authenticated vs unauthenticated behavior. Public listing data likely accessible without login; saved homes/alerts require auth.

## Transport
Must be `page` — all endpoints behind PerimeterX. Node transport impossible without PX bypass.

## Known Issues

### PerimeterX (Critical Blocker)
- **App ID**: `PXHYx10rg3`
- **Scope**: All endpoints on `www.zillow.com` except `robots.txt` and static assets
- **Detection layers**:
  1. **TLS fingerprint (JA3/JA4)**: curl/node-fetch rejected immediately — different cipher suite ordering from browsers
  2. **HTTP/2 fingerprint**: SETTINGS frame parameters expose non-browser clients
  3. **JavaScript challenge**: `/HYx10rg3/init.js` collects canvas/WebGL/navigator fingerprints
  4. **Behavioral analysis**: "Press & Hold" CAPTCHA analyzes mouse movement, press duration, input event authenticity
  5. **IP reputation**: Accumulated non-browser requests raise risk score; poisons subsequent browser sessions on same IP
- **IP poisoning observed**: After ~15 curl probes, even a real user in a real browser (default profile, logged in) could not solve the CAPTCHA. PX returned "please try again" indefinitely.
- **Recovery**: Wait 15–60 min for risk score decay, or change IP (VPN/hotspot)
