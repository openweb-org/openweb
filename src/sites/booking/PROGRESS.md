## 2026-04-01: Fresh discovery — 5 operations

**What changed:**
- Created booking.com package from scratch with 5 operations
- searchHotels, getHotelDetail, getHotelReviews, getHotelPrices, searchFlights
- Adapter-based DOM/LD+JSON extraction (booking-web)
- Added flights search via flights.booking.com subdomain

**Why:**
- Prior package deleted during batch cleanup; rediscovering from scratch
- User requested: searchHotels, getHotelDetail, getHotelReviews, getHotelPrices, searchFlights

**Verification:** DOM selectors validated live on booking.com — search cards (28 results), LD+JSON Hotel schema, review-score-component, hprt-table rooms, flight cards (25 results)
**Commit:** pending
