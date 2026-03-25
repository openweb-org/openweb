# Indeed Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created indeed with 10 operations: searchJobs, getJobDetail, getSalary, getCompanyOverview, getCompanyReviews, getCompanySalaries, getReviewFilters, autocompleteJobTitle, autocompleteLocation, browseJobCategories
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md, adapters/indeed-web.ts

**Why:**
- Indeed is the largest job search platform — job search, salary data, and company reviews are high-value operations
- All 10 operations work without auth via page-based extraction
- Indeed uses Cloudflare bot detection, requiring L3 page transport for all operations

**Discovery process:**
1. Browsed Indeed systematically via Playwright (16 pages: homepage, job search × 4 queries, job detail, salary × 3, company × 2, reviews × 2, company salaries, browse jobs, salary explorer)
2. Captured 551 network requests across 20 page navigations
3. Analyzed data sources:
   - `window._initialData` for job search (totalJobCount, page metadata)
   - `window.mosaic.providerData['mosaic-provider-jobcards']` for job card data (25 results with full metadata)
   - `application/ld+json` JobPosting schema on viewjob pages (salary, description, company)
   - `__NEXT_DATA__` on salary pages (Next.js — rich salary data with distributions, top cities, top companies)
   - `window._initialData` on company pages (20 section view models)
   - DOM extraction for reviews (itemprop/data-testid selectors)
   - `/cmp/_rpc/review-filter` API (298KB JSON with filter metadata)
   - `autocomplete.indeed.com/api/v0/suggestions/*` for autocomplete
4. Built L3 adapter (indeed-web.ts) with page navigation + data extraction for all operations
5. Curated to 10 operations covering job search, detail, salary, company info, reviews, autocomplete, and browsing

**Key decisions:**
- All L3 (page transport) because Cloudflare bot detection blocks direct HTTP
- Salary pages use Next.js `__NEXT_DATA__` extraction — most stable and data-rich source
- Job detail uses `application/ld+json` (JobPosting schema.org) as primary source — standardized and unlikely to change
- Job search uses mosaic micro-frontend provider data — requires 3s wait for async loading
- Autocomplete endpoints called via `page.evaluate(fetch)` from page context

**Verification:** Pending — to be verified via browser-based testing
