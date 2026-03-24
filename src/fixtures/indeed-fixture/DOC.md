# Indeed

## Overview
Job search platform. Search jobs by keyword and location, view full job postings, salary data for any role, company profiles with ratings, employee reviews, and company salary breakdowns.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchJobs | search jobs by keyword & location | GET /jobs?q={q}&l={l} | returns 15-25 job cards per page with title, company, salary, snippet; paginate with start=10,20,... |
| getJobDetail | get full job posting | GET /viewjob?jk={jk} | LD+JSON JobPosting schema + _initialData; salary, benefits, description, hiring insights |
| getSalary | salary data for a role | GET /career/{title}/salaries | Next.js __NEXT_DATA__; median/min/max by period, top cities, top companies, related titles |
| getCompanyOverview | company info & ratings | GET /cmp/{company} | _initialData with about, ratings, salaries, jobs, locations, interviews, FAQ |
| getCompanyReviews | employee reviews | GET /cmp/{company}/reviews | DOM extraction; individual reviews with rating, pros, cons, job title |
| getCompanySalaries | salaries at a company | GET /cmp/{company}/salaries | DOM extraction; job titles with salary data |
| getReviewFilters | review filter metadata | intercept /cmp/_rpc/review-filter | job titles (1000+), locations, categories for filtering reviews |
| autocompleteJobTitle | job title suggestions | page.evaluate fetch to autocomplete.indeed.com | normalized job title suggestions |
| autocompleteLocation | location suggestions | page.evaluate fetch to autocomplete.indeed.com | city/state/country suggestions |
| browseJobCategories | browse job categories | GET /browsejobs | job category links and popular searches |

## API Architecture
- **SSR-heavy site**: No public REST API. Data embedded in SSR HTML via multiple patterns:
  - `window._initialData` — job search results, company pages, job detail
  - `window.mosaic.providerData['mosaic-provider-jobcards']` — job card data in search results
  - `__NEXT_DATA__` — salary pages (Next.js)
  - `application/ld+json` — structured data (JobPosting on detail pages, LocalBusiness on company pages)
- **Internal APIs**: `/cmp/_rpc/review-filter` (review metadata), `autocomplete.indeed.com/api/v0/suggestions/*` (autocomplete)
- **Mosaic architecture**: Indeed uses a micro-frontend system called "mosaic" with provider-based data injection

## Auth
- No auth needed for all 10 operations
- `requires_auth: false`
- Logged-in users get personalized results (saved jobs, applied status) but all public data is accessible without login

## Transport
- `page` (L3 adapter) — all operations via page navigation + data extraction
- **Cloudflare bot detection**: Direct HTTP requests trigger challenge pages (`cdn-cgi/challenge-platform`)
- Cannot downgrade to `node` — all endpoints require browser context to bypass bot detection
- Autocomplete APIs (`autocomplete.indeed.com`) called via `page.evaluate(fetch)` to inherit browser cookies/context

## Extraction
- Job search: `window.mosaic.providerData` → `mosaicProviderJobCardsModel.results`
- Job detail: `application/ld+json` (JobPosting) + `window._initialData` supplement
- Salary: `__NEXT_DATA__` props.pageProps (Next.js SSR)
- Company: `window._initialData` (20+ section view models)
- Reviews: DOM scraping (`[itemprop]` elements) + `/cmp/_rpc/review-filter` API interception
- Autocomplete: `page.evaluate(fetch)` to autocomplete subdomain

## Known Issues
- **DOM selectors may drift** — Indeed frequently updates its frontend. Data-testid attributes and CSS classes may change. LD+JSON and `_initialData` are more stable.
- **Job search mosaic data** — The `mosaic.providerData` structure is loaded asynchronously by micro-frontends. Timing-sensitive — the 3-second wait after navigation is required.
- **Salary page location format** — Location must use Indeed's URL segment format (e.g. "San-Francisco--CA" not "San Francisco, CA"). Use autocompleteLocation to find valid segments.
- **Review DOM fragility** — Review card selectors (`[itemprop="review"]`, `[data-testid="reviewCard"]`) may change. The review-filter API is stable but only returns filter metadata, not actual reviews.
- **Rate limiting** — Rapid page navigation may trigger Cloudflare challenges. Space out requests.
