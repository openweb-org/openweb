## 2026-04-14: Fix getAvailability HTTP 409

**Context:** `pnpm dev verify opentable` failed on getAvailability with HTTP 409 "Conflict"
**Changes:**
- Updated `RestaurantsAvailability` persisted query hash (rotated on OpenTable's servers)
- Added `ot-page-group` / `ot-page-type` headers to GQL fetch (now required for availability)
- Updated GQL variables: `requireTypes`, `forwardMinutes`/`backwardMinutes`, `useCBR`, `loyaltyRedemptionTiers`
- Removed stale hardcoded `restaurantAvailabilityTokens`
- Updated example dates from 2026-04-12 (past) to 2027-01-15

**Verification:** 4/4 PASS
**Key discovery:** OpenTable returns HTTP 409 "Conflict" (text/plain) for stale persisted query hashes — not the standard APQ PersistedQueryNotFound JSON error. Diagnosis requires intercepting the response body, not just the status code.

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (## → ###), added Extraction subsection
- openapi.yaml: added `required` arrays to all response objects, `description` on every property, `example` on all parameters, no bare `type: object`
- All 4 example files: added `replay_safety: safe_read`
- Added manifest.json

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify opentable`

## 2026-04-09: Initial site package

**What changed:**
- Added 4 operations: searchRestaurants, getRestaurant, getAvailability, getReviews
- Adapter-only package (no compile) — search/detail via SSR extraction, availability/reviews via GraphQL persisted queries
- Page transport for all operations (Akamai bot detection)

**Why:**
- Net-new site addition per add-site guide

**Verification:** adapter-verified against live site (search, detail, availability, reviews)
