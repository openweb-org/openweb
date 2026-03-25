# Booking.com Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created booking with 10 operations: searchProperties, getPropertyDetail, getPropertyReviews, getPropertyRooms, getPropertyFacilities, getPropertyLocation, getPropertyPhotos, getPropertyHouseRules, getPropertyFAQ, searchAll
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md
- Created adapters/booking-web.ts for DOM/LD+JSON extraction

**Why:**
- Booking.com is the world's largest hotel booking platform — hotel search, price comparison, and reviews are high-value operations
- GraphQL at /dml/graphql is internal and not stable for direct access
- Bot detection blocks direct HTTP requests — browser-only access required

**Discovery process:**
1. Planned 10 target operations covering hotel search, property details, reviews, rooms, facilities, location, photos, house rules, FAQ
2. Browsed booking.com via CDP — homepage redirects to login, but direct URLs (/searchresults.html, /hotel/...) work
3. Inspected search results: data-testid property cards with title, price, review-score, distance
4. Inspected property page: LD+JSON Hotel schema + rich DOM sections for reviews (7 category subscores), rooms (hprt-table), facilities, POIs, gallery, house rules, FAQ
5. Built fixture with page transport + booking-web adapter for DOM/LD+JSON extraction

**Verification:** Adapter created based on confirmed DOM structure; build verification pending.

**Knowledge updates:** Homepage login redirect in automated browsers (use direct URLs), LD+JSON Hotel schema on property pages, data-testid DOM structure for search results and property sections.
