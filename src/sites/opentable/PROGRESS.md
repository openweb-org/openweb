## 2026-04-09: Initial site package

**What changed:**
- Added 4 operations: searchRestaurants, getRestaurant, getAvailability, getReviews
- Adapter-only package (no compile) — search/detail via SSR extraction, availability/reviews via GraphQL persisted queries
- Page transport for all operations (Akamai bot detection)

**Why:**
- Net-new site addition per add-site guide

**Verification:** adapter-verified against live site (search, detail, availability, reviews)
