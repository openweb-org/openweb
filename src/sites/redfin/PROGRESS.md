## 2026-04-02: Fix adapter navigation

**What changed:**
- Added `navigateTo()` helper — all 3 ops now navigate to the correct Redfin
  URL using path params before DOM/JSON-LD extraction
- searchHomes: `/city/{regionId}/{state}/{city}`
- getPropertyDetails: `/{state}/{city}/{address}/home/{propertyId}`
- getMarketData: `/city/{regionId}/{state}/{city}/housing-market`

**Why:**
- Adapter received page at `redfin.com/` but never navigated. searchHomes
  returned listings from the wrong city (whatever was cached on the page).

**Key files:** `adapters/redfin-dom.ts`
**Verification:** `searchHomes '{"regionId":"16163","state":"WA","city":"Seattle"}'` → 41 Seattle listings; `getMarketData` → Seattle median $849k
**Commit:** b237c7c

## 2026-04-01: Initial discovery — 3 operations

**What changed:**
- Created adapter-only package with 3 operations: searchHomes, getPropertyDetails, getMarketData
- JSON-LD extraction for search listings and property details
- DOM text extraction for housing market data

**Why:**
- Redfin is fully SSR-rendered — no JSON APIs. Standard capture → compile produces 0 usable operations.
- Adapter-only workflow per discover.md "Adapter-Only Sites"

**Verification:** adapter-verified via openweb verify
