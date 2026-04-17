# TripAdvisor — Progress

## 2026-04-17 — Phase 3 Normalize-Adapter (cb44577)

**Context:** Move extraction logic from adapter handlers into spec `x-openweb.extraction` blocks so the runtime can drive extraction directly.
**Changes:**
- `searchHotels`, `getHotelDetail`, `searchRestaurants`, `getRestaurant`, `getAttractionDetail`, `getAttractionReviews` → migrated to `page_global_data` (LD+JSON parsing with DOM fallbacks)
- `searchLocation` → kept on `tripadvisor` adapter (in-page `fetch()` to TypeAheadJson endpoint)
- Adapter shrunk from ~480 lines to ~106 lines; retained DataDome CAPTCHA gate around all ops
**Verification:** 7/7 PASS via `pnpm dev verify tripadvisor --browser`.
