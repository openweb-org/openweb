# Etsy — Progress

## 2026-04-09: Initial site package

**What changed:**
- Added Etsy site package with 4 operations: searchListings, getListingDetail, getReviews, getShop
- Adapter-based extraction using LD+JSON (schema.org) and DOM
- Page transport required — Cloudflare + PerimeterX + DataDome block direct HTTP

**Why:**
- New site request for handmade/vintage marketplace coverage

**Verification:** All 4 operations PASS runtime verify (searchListings, getListingDetail, getReviews, getShop)
**Commit:** pending
