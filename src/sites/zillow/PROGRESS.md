## 2026-04-09: Polish zillow site package

**What changed:**
- Fixed DOC.md heading levels (Site Internals subsections now `###`)
- Added `required` arrays to all 4 response schemas — top-level and nested objects (address, latLong, regionInfo items, school items, nearbyHome items, zestimateHistory items)
- Added `description` on every property at every nesting level — no bare type-only fields
- Added `example` values to all path parameters (zpid, slug)
- Added `verified: true` and `signals: [adapter-verified]` to adapter build sections; `signals: [page-verified]` for searchProperties
- Added `replay_safety: "safe_read"` to all 4 example files
- Fixed `requires_auth` mismatch in manifest.json (`true` → `false` to match openapi.yaml)

**Why:**
- Quality checklist: no bare type:object, required where data always present, complete property descriptions, examples on parameters, replay_safety on examples
- Enhanced site (1→4 ops): getPropertyDetail, getZestimate, getNeighborhood schemas fully hardened

**Key files:**
- `src/sites/zillow/openapi.yaml` — schema hardening across all 4 ops
- `src/sites/zillow/DOC.md` — heading level fix
- `src/sites/zillow/manifest.json` — requires_auth fix
- `src/sites/zillow/examples/*.example.json` — replay_safety added

**Verification:** pnpm build, pnpm dev verify zillow

## 2026-04-06: Initial site package

**What changed:**
- Created zillow site package with 1 operation: searchProperties
- PUT /async-create-search-page-state — search properties by location, price, beds/baths
- Page transport (PerimeterX blocks node HTTP)
- cookie_session auth (search works without login)
- Added example fixture for San Francisco search
- Response schema covers listResults and mapResults with property details

**Why:**
- Zillow's SPA search API provides structured property data (address, price, beds, baths, sqft, zestimate, lat/lng, photos)
- PerimeterX bot detection requires page transport with real Chrome profile
- Search does not require login (`requires_auth: false`), though logged-in users get personalized results

**Verification:** compile-time verify (page transport ops pending browser verify)

## 2026-04-05: Verify fixes

**What changed:**
- Created examples/searchProperties.example.json (San Francisco search fixture)
- Fixed requires_auth mismatch: manifest.json said `true`, openapi.yaml said `false` — aligned to `false`
- Created PROGRESS.md

**Verification:** `openweb verify zillow --browser` → `auth_expired` (expected — needs `openweb login zillow` for active session)
