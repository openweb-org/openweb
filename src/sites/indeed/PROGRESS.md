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
