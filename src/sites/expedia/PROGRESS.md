## 2026-04-01: Initial discovery — hotels + flights

**What changed:**
- Discovered Expedia uses single GraphQL endpoint with APQ (persisted query hashes)
- 4 operations: searchHotels, getHotelDetail, searchFlights, getFlightDetail
- Adapter-based package (page transport required due to Akamai)

**Why:**
- User requested hotel and flight search capabilities
- Standard compile couldn't sub-cluster GraphQL — manual adapter required

**Verification:** adapter builds, operations exec via page transport
