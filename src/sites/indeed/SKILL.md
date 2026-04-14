# Indeed

## Overview
Job search platform. Search jobs, view postings, salary data, company profiles, and reviews.

## Workflows

### Find and apply to jobs
1. `searchJobs(q, l)` → `jobkey`, title, company, salary
2. `getJobDetail(jk=jobkey)` → full posting with description, salary, benefits, company info

### Research salaries
1. `autocompleteJobTitle(q)` → `title` (normalized)
2. `getSalary(title)` → median, range, top cities, top companies
3. `getSalary(title, location)` → location-specific salary

### Research a company
All use the same `company` slug (entry point):
1. `getCompanyOverview(company)` → ratings, about, jobs, locations
2. `getCompanyReviews(company)` → employee reviews with pros/cons
3. `getCompanySalaries(company)` → salary by job title

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchJobs | search jobs by keyword & location | q, l (optional) | jobkey, title, company, salary, snippet | entry point; paginate with start=10,20,... |
| getJobDetail | get full job posting | jk ← searchJobs → jobkey | title, description, salary, benefits, company | LD+JSON + _initialData |
| getSalary | salary data for a role | title ← autocompleteJobTitle, location (optional) | median, min, max, top cities, top companies | Next.js __NEXT_DATA__ |
| getCompanyOverview | company info & ratings | company slug | about, ratings, salaries, jobs, locations | entry point; _initialData |
| getCompanyReviews | employee reviews | company slug | reviews[].rating, text, jobTitle, subcategory ratings | entry point; _initialData + LD+JSON |
| getCompanySalaries | salaries at a company | company slug | categories[].salaries[].jobTitle, salary; popularJobs | entry point; _initialData |
| autocompleteJobTitle | job title suggestions | q (partial text) | normalized job titles | entry point; feeds getSalary |
| autocompleteLocation | location suggestions | q (partial text) | city/state/country suggestions | entry point; feeds getSalary, searchJobs |

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
