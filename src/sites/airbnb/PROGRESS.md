## 2026-04-25: Userflow QA — response trimming, host profile fix

**Personas tested:**
1. Family beach vacation — search Santa Cruz, 4 guests, July
2. Digital nomad — search Lisbon, 1-month stay
3. Couple weekend getaway — search Napa Valley, 2 guests

**Issues found & fixed:**

| Severity | Issue | Fix |
|----------|-------|-----|
| CRITICAL | `getHostProfile` returned raw page config (API keys, tracking, Google Maps URLs) instead of actual profile data. Host profile page uses `data-injector-instances` SSR, not `data-deferred-state`. | Rewrote extraction to parse `data-injector-instances` → `NiobeClientToken` → `UserProfileLegacyQuery` → `userProfileContainer.userProfile`. Switched from browser to node fetch. |
| HIGH | `searchListings` response 200–260KB. 11 noise top-level keys (`loggingMetadata`, `filters`, `seo`, `pricingToggle`, `mapToasts`, `sectionConfiguration`, `announcements`, etc.) | Added `trimSearch()` — keep only `searchResults` + `paginationInfo`. Now 72–85KB. |
| HIGH | `getListingDetail` response 150–238KB. 32 sections including 17 UI-chrome sections, plus `sectionsV2`/`screens`/`flows`/`sbuiData` noise. | Added `trimDetail()` — drop UI-chrome sections, strip section wrappers, cap hero images to 10, remove empty sections. Now 37–52KB. |
| MEDIUM | `__typename` on every object at every level across all adapter responses. | Added recursive `trimResponse()` stripping `__typename` and other GraphQL/logging artifacts. |
| LOW | Example fixture used inaccessible host ID (70270073 → redirects to login). | Updated example and spec to use publicly accessible host ID 95592328. |

**Response size before/after:**
- `searchListings`: 232KB → 72KB (−69%)
- `getListingDetail`: 238KB → 37KB (−84%)
- `getHostProfile`: broken → 13KB (fixed, node SSR)
- `getListingReviews`: 88KB (spec-driven, no adapter trim)
- `getListingAvailability`: 31KB (spec-driven, no adapter trim)

**Known remaining:**
- `getListingReviews` and `getListingAvailability` still have `__typename` in responses (spec-driven ops, trimming would require runtime-level stripping)
- Server-level transport is still `page` although all adapter ops now use node fetch internally; browser still launched but unused for adapter ops

---

## 2026-04-17: Run-export blocker on 3 adapter-based ops

**Status:** `getListingReviews` and `getListingAvailability` migrated to graphql_hash GET
(no adapter) and verify PASS. The remaining 3 ops — `searchListings`, `getListingDetail`,
`getHostProfile` — still rely on the `airbnb` CustomRunner adapter and currently fail
verify with:

> Adapter "airbnb" failed to load: …/airbnb.js: module has no valid adapter export (expected `run`)

This is a pre-existing adapter export/loader issue, not caused by the migration.
Tracked separately; out of scope for the normalize-adapter milestone.

---

## 2026-04-09: Expand to 5 operations — reviews, availability, host profile

**What changed:**
- Added `airbnb-web` adapter (`adapters/airbnb-web.ts`) for section-filtered SSR extraction
- New operations: `getListingReviews`, `getListingAvailability`, `getHostProfile`
- Reviews and availability extract from detail page SSR sections (REVIEW, BOOK, AVAILABILITY, etc.)
- Host profile navigates to `/users/show/{hostId}` and extracts full SSR presentation data
- Example fixtures for all three new operations
- Updated DOC.md with new workflows, operations table, and extraction details
- Version bumped to 1.1.0, operation count 2 → 5

**Why:**
- Expand Airbnb coverage beyond search+detail to support listing evaluation and host research workflows

**Verification:** `pnpm build` + `openweb verify airbnb --browser`

---

## 2026-04-05: Fix verify — add example fixtures, pass all three dimensions

**What changed:**
- Created `examples/` directory with fixtures for both operations
  - `searchListings.example.json` — search Tokyo
  - `getListingDetail.example.json` — listing detail for verified ID
- Root cause: verify requires `examples/*.example.json` files to test operations;
  the airbnb package had none, so verify returned FAIL with zero operations

**Why:**
- Verify gate requires example fixtures for runtime validation (verify.md)

**Verification:** `openweb verify airbnb --browser` — PASS (both operations)

---

## 2026-04-05: Initial package — 2 operations, page transport, adapter extraction

**What changed:**
- Created airbnb site package with 2 operations: searchListings, getListingDetail
- Built `airbnb-web` adapter for SSR extraction from `data-deferred-state-0` script tag
- DOC.md with workflows, operations table, quick start, and site internals

**Why:**
- Add accommodation search coverage via browser SSR extraction

**Verification:** Manual exec of both operations returns valid data
