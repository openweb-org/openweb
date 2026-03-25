# Expedia Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created expedia with 10 operations: searchHotels, getHotelDetail, getHotelReviews, getHotelRooms, getHotelPhotos, getHotelLocation, getHotelFAQ, searchActivities, searchCarRentals, getDeals
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md
- Created adapters/expedia-web.ts for DOM/LD+JSON extraction

**Why:**
- Expedia is a major OTA (Online Travel Agency) — hotel search, activities, car rentals, and deals are high-value operations
- Flight+hotel bundles and price alerts were target intents; flights use complex SPA routing that returns errors on direct URLs, so we cover hotel deals and activities instead
- Bot detection (PerimeterX) blocks direct HTTP — browser-only access required

**Discovery process:**
1. Planned 10 target operations covering hotel search/detail/reviews/rooms/photos/location/FAQ, activities, car rentals, deals
2. Browsed expedia.com via CDP — captured 34 snapshots across hotel search, hotel detail, flights, packages, car rentals, activities, deals, cruises
3. Inspected DOM: hotel search uses data-stid="lodging-card-responsive" cards; hotel detail has LD+JSON ItemList with Hotel objects + FAQPage
4. Flight search URLs return error page (SPA routing); packages redirect without clear results; focused on working verticals
5. Built fixture with page transport + expedia-web adapter for DOM/LD+JSON extraction

**Verification:** Adapter created based on confirmed DOM structure; build verification pending.

**Knowledge updates:** LD+JSON ItemList pattern for hotel detail (not standalone Hotel type), trvl-media.com image CDN, data-stid convention for Expedia DOM elements.
