# Indeed

## Overview
Job search platform. Search jobs, view postings, salary data, company profiles, and reviews.

## Workflows

### Find and apply to jobs
1. `searchJobs(q, l)` → browse results → `jobkey`
2. `getJobDetail(jk)` → full posting with salary, benefits, company info

### Research salaries
1. `autocompleteJobTitle(q)` → normalized job title
2. `getSalary(title)` → median, range, top cities, top companies
3. `getSalary(title, location)` → location-specific salary

### Research a company
1. `getCompanyOverview(company)` → ratings, about, jobs, locations
2. `getCompanyReviews(company)` → employee reviews with pros/cons
3. `getCompanySalaries(company)` → salary by job title

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchJobs | search jobs by keyword & location | q, l (optional) | jobkey, title, company, salary, snippet | entry point; paginate with start=10,20,... |
| getJobDetail | get full job posting | jk ← searchJobs | title, description, salary, benefits, company | LD+JSON + _initialData |
| getSalary | salary data for a role | title, location (optional) | median, min, max, top cities, top companies | Next.js __NEXT_DATA__ |
| getCompanyOverview | company info & ratings | company slug | about, ratings, salaries, jobs, locations | entry point; _initialData |
| getCompanyReviews | employee reviews | company ← getCompanyOverview | reviews[].rating, pros, cons, jobTitle | DOM extraction |
| getCompanySalaries | salaries at a company | company ← getCompanyOverview | salaries[].jobTitle, salary | DOM extraction |
| autocompleteJobTitle | job title suggestions | q (partial text) | normalized job titles | entry point |
| autocompleteLocation | location suggestions | q (partial text) | city/state/country suggestions | entry point |

## Quick Start

```bash
# Search for jobs
openweb indeed exec searchJobs '{"q":"software engineer","l":"San Francisco, CA"}'

# Get job details (use jobkey from search results)
openweb indeed exec getJobDetail '{"jk":"72046173738a7637"}'

# Get salary data
openweb indeed exec getSalary '{"title":"software engineer"}'

# Company overview
openweb indeed exec getCompanyOverview '{"company":"Google"}'

# Company reviews
openweb indeed exec getCompanyReviews '{"company":"Google"}'

# Autocomplete job title
openweb indeed exec autocompleteJobTitle '{"q":"softw"}'
```

---

## Site Internals

## API Architecture
- **SSR-heavy site**: No public REST API. Data embedded in SSR HTML via:
  - `window._initialData` — job search results, company pages, job detail
  - `window.mosaic.providerData['mosaic-provider-jobcards']` — job card data
  - `__NEXT_DATA__` — salary pages (Next.js)
  - `application/ld+json` — structured data (JobPosting, LocalBusiness)
- **Autocomplete APIs**: `autocomplete.indeed.com/api/v0/suggestions/*` called via page.evaluate(fetch)
- **Mosaic architecture**: Micro-frontend system with provider-based data injection

## Auth
No auth required. All 8 operations return public data.

## Transport
- `page` for all 8 ops (Cloudflare bot detection blocks direct HTTP)
- **Hybrid**: 5 of 8 ops use spec `x-openweb.extraction` (`page_global_data` reading `_initialData` / `mosaic.providerData` / LD+JSON). Remaining 3 ops stay on the thin `indeed-web` adapter because they need a slug transform (`getSalary`) or in-page `fetch()` to the autocomplete subdomain (`autocompleteJobTitle`, `autocompleteLocation`).

## Extraction
- `searchJobs` → `page_global_data`: `window.mosaic.providerData['mosaic-provider-jobcards']` → `mosaicProviderJobCardsModel.results` + `_initialData` totals
- `getJobDetail` → `page_global_data`: LD+JSON `JobPosting` merged with `window._initialData`
- `getCompanyOverview` → `page_global_data`: `_initialData` section view models
- `getCompanyReviews` → `page_global_data`: `_initialData.reviewsList.items` + LD+JSON `EmployerAggregateRating`
- `getCompanySalaries` → `page_global_data`: `_initialData.categorySalarySection.categories` + `salaryPopularJobsSection.popularJobTitles`
- `getSalary` → adapter: `__NEXT_DATA__` props.pageProps (after slug transform)
- `autocompleteJobTitle` / `autocompleteLocation` → adapter: `page.evaluate(fetch)` to `autocomplete.indeed.com`

## Adapter Patterns
- `getSalary` — title is converted to a URL slug (`software engineer` → `software-engineer`) before navigation; spec extraction can't compute the URL.
- `autocompleteJobTitle`, `autocompleteLocation` — call the `autocomplete.indeed.com` JSON API via in-page `fetch()` to inherit Cloudflare cookies.

## Known Issues
- **Mosaic data timing** — `mosaic.providerData` loads asynchronously. The 3-second wait after navigation is required.
- **Salary location format** — Must use Indeed's URL segment format (e.g. "San-Francisco--CA"). Use autocompleteLocation.
- **Cloudflare challenges** — Rapid page navigation may trigger bot detection. Space out requests.
- **Review subcategory ratings** — Some reviews return 0 for all subcategory ratings (compensation, culture, work-life, management, job security) when the reviewer didn't fill them out.
