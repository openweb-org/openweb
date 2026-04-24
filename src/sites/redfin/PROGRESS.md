## 2026-04-24: Userflow QA — response trimming and fixes

**What changed:**
- searchHomes: full absolute URLs (was relative paths), dropped redundant fields
  (name, city, state, latitude, longitude, currency), reduced to 15 listings to
  fit 4096-byte inline gate
- getPropertyDetails: proper HTML entity decoding (handles `&frac34;`, numeric
  entities), description capped at 400 chars, availability normalized from
  schema.org URL to human-readable value (e.g. "InStock")
- getMarketData: removed `neighborhood`, `marketType`, `summary` fields — always
  null via node transport (client-side rendered only)
- Updated openapi.yaml schema to match all adapter changes
- Synced redfin-dom.js fallback adapter to match

**Why:**
- searchHomes returned relative URLs (agent can't use directly), response
  exceeded 4096-byte inline threshold causing temp-file spill
- `&frac34;` left raw in descriptions (regex `&[a-z]+;` missed entities with
  digits)
- Three getMarketData fields always null because Redfin renders market insights
  client-side only — dead weight in the response

**Key files:** `adapters/redfin.ts`, `adapters/redfin-dom.js`, `openapi.yaml`
**Verification:** searchHomes Seattle 15 listings inline (3143 bytes); getPropertyDetails `&frac34;` → `¾`; getMarketData clean 7-field response

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
