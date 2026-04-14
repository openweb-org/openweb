## 2026-04-01: Fresh discovery and compile

**What changed:**
- Full rediscovery from scratch with browser capture (12 page navigations + 2 autocomplete API calls)
- 8 operations: searchJobs, getJobDetail, getSalary, getCompanyOverview, getCompanyReviews, getCompanySalaries, autocompleteJobTitle, autocompleteLocation
- All operations use page transport with L3 adapter (indeed-web)
- Auto-compile found 38 ops (mostly tracking/logging), curated down to 8 useful operations
- Autocomplete APIs (autocomplete.indeed.com) called via page.evaluate(fetch)

**Why:**
- Prior package was quarantined and deleted in batch cleanup
- Rediscovery validates current Indeed DOM structure and extraction patterns

**Verification:** Runtime verify with --browser, manual exec of target intents

## 2026-04-13 — Schema Fix

**Context:** getCompanySalaries response objects omit fields when salary data is sparse or unavailable.
**Changes:** openapi.yaml — removed required on getCompanySalaries response schema.
**Verification:** Verify pass; schema accepts partial salary objects from the API.

## 2026-04-14 — Transport Upgrade: Reviews + Salaries (Tier 2 → Tier 3)

**Context:** getCompanyReviews and getCompanySalaries used Tier 2 DOM selectors that had drifted (broken `[data-testid]` selectors returning empty data).
**Changes:**
- `getCompanyReviews`: switched from querySelector DOM extraction to `_initialData.reviewsList.items` + LD+JSON `EmployerAggregateRating`. Now returns 20 rich reviews per page with title, rating, jobTitle, location, date, text, and 5 subcategory ratings.
- `getCompanySalaries`: switched from querySelector DOM extraction to `_initialData.categorySalarySection.categories` + `salaryPopularJobsSection.popularJobTitles`. Now returns salary data grouped by category (6 categories), 100 popular job titles with median salaries, and satisfaction data.
- Updated openapi.yaml response schemas to match new richer data shapes.
- Removed known issues for broken DOM selectors.
**Verification:** `pnpm dev verify indeed --browser` — 8/8 ops PASS.
