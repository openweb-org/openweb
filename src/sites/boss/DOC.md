# Boss直聘 (BOSS Zhipin)

## Overview
China's leading direct-recruiting job platform (Chinese web / job board archetype). Job seekers chat directly with bosses/HR. Search jobs, view details with salary info, explore company profiles, and get salary statistics.

## Workflows

### Find and explore jobs
1. `searchJobs(query, city)` → job cards with `jobLink`
2. `getJobDetail(jobId ← jobLink)` → full posting with `company.link`
3. `getCompanyProfile(companyId ← company.link)` → company info + open positions

### Research salaries
1. `getSalary(query, city)` → aggregated salary ranges for a position in a city

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchJobs | search jobs by keyword & city | query, city | jobName, salaryDesc, company, jobLink, companyLink | entry point; paginated |
| getJobDetail | get full job posting | jobId ← searchJobs.jobLink | jobName, salaryDesc, jobDescription, company, boss, tags | |
| getCompanyProfile | get company profile | companyId ← getJobDetail.company.link | name, industry, size, stage, description, jobs | |
| getSalary | salary statistics for a position | query, city | averageMin, averageMax, minRange, maxRange, samples | aggregated from search listings |
| getCities | get all cities with codes | — | hotCityList, cityList (province-grouped) | entry point; reference data |
| getIndustries | get industry categories | — | code, name, subLevelModelList | reference data |
| getFilterConditions | get search filter options | — | salaryList, experienceList, degreeList, stageList, scaleList, jobTypeList | reference data |

## Quick Start

```bash
# Search for Java jobs in Beijing
openweb boss exec searchJobs '{"query":"Java","city":"101010100"}'

# Get job details (use jobLink from search)
openweb boss exec getJobDetail '{"jobId":"/job_detail/xxx.html"}'

# Get company profile (use company.link from job detail)
openweb boss exec getCompanyProfile '{"companyId":"xxx.html"}'

# Get salary stats for product managers in Shanghai
openweb boss exec getSalary '{"query":"产品经理","city":"101020100"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
- **Vue.js SPA**: `/web/geek/job` serves an HTML shell; all content rendered client-side
- **Response format**: DOM extraction — no JSON API for search/detail/company pages
- **City codes**: All search operations use numeric city codes (e.g. 101010100 = Beijing)

## Auth
No auth required for reading job data. Session cookie `__zp_stoken__` exists but is not needed for core operations.

## Transport
- `page` transport — all core operations driven by spec extraction (`x-openweb.extraction.page_global_data`); runtime navigates to `page_url` then evaluates the embedded expression
- Reference data ops (getCities, getIndustries, getFilterConditions) use `node` transport — public APIs that bypass bot detection

## Extraction
- All 4 core ops (`searchJobs`, `getJobDetail`, `getCompanyProfile`, `getSalary`) use `page_global_data` with DOM expressions (CSS-selector queries via `document.querySelectorAll`) embedded in `openapi.yaml`
- Reference data ops (getCities, getIndustries, getFilterConditions) return JSON directly — no extraction needed

## Adapter Patterns
Adapter removed in Phase 3 (normalize-adapter); all ops now use spec extraction primitives.

## Known Issues
- **Bot detection**: Fingerprint-based detection blocks new automated tabs. Page extraction works in a browser session where a human has already passed verification.
- **Job detail / company pages may require login**: Detail and company profile pages intermittently show login prompts under bot detection. Search results are more reliable.
- **Salary hidden on search cards**: Boss直聘 hides salary text in search result cards from automated extraction (anti-scraping). `salaryDesc` may return empty. `getSalary` depends on this and may return empty results.
- **DOM selectors may drift**: Boss直聘 updates frontend frequently; CSS class names may change.
