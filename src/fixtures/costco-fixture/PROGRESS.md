# Costco Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Discovered Costco's API architecture: POST-based search API on `gdx-api.costco.com` + GraphQL product API on `ecom-api.costco.com`
- Created L3 adapter (`costco-api.ts`) with two operations: `searchProducts`, `getProductDetail`
- Overcame PerimeterX blocking `page.evaluate(fetch(...))` — switched to `page.request.fetch()`
- Identified required custom headers: `client-identifier`, `costco.env`, `costco.service`
- Fixed search 500 error by adding `visitorId` and `userInfo` to request body
- Fixed product 404 by adding `costco.env: ecom` and `costco.service: restProduct` headers
- Fixed brand extraction (prefer `attributes.Brand` over `fieldData.mfName` which can be garbage)
- Fixed rating type (string from API → number in adapter)
- Updated knowledge files: `archetypes.md` (e-commerce PerimeterX patterns), `auth-patterns.md` (Costco not blocked)

**Why:**
- M26 discovery task: add Costco product search and detail coverage
- Costco is a major e-commerce site with unique POST-based API + PerimeterX combination

**Verification:** API-level PASS (both operations). Content-level verified: search results match visible products on costco.com (titles, brands, promotions). Product detail returns correct prices ($499.99 Acer laptop), ratings (3.9/5, 219 ratings), full HTML descriptions, and attributes. Build passes.
**Commit:** d8dc743 (initial), 31d2f6b (PerimeterX bypass + verification fixes)
