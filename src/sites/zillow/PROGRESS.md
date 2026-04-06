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
