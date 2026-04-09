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
