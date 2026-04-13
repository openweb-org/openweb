# Glassdoor

## Overview
Glassdoor is a company review and job research platform (archetype: job boards). All data accessed via browser-based adapter with Cloudflare challenge bypass; no official API.

## Workflows

### Research a company
1. `searchCompanies(query)` → company list with employer IDs and ratings
2. `getReviews(employerId)` → employee reviews with pros, cons, ratings
3. `getSalaries(employerId)` → salary data by job title with pay ranges
4. `getInterviews(employerId)` → interview experiences with difficulty and outcomes

### Compare company compensation
1. `searchCompanies(query)` → get employerId for company A
2. `getSalaries(employerId)` → salary ranges for company A
3. Repeat for company B

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchCompanies | find companies by name | query | employerId, name, overallRating | entry point |
| getReviews | employee reviews | employerId ← searchCompanies | rating, title, pros, cons, jobTitle | SSR + DOM |
| getSalaries | salary data by role | employerId ← searchCompanies | jobTitle, payRange, salaryCount | DOM extraction |
| getInterviews | interview experiences | employerId ← searchCompanies | role, difficulty, experience, description | DOM extraction |

## Quick Start

```bash
openweb glassdoor exec searchCompanies '{"query":"Google"}'
openweb glassdoor exec getReviews '{"employerId":9079}'
openweb glassdoor exec getSalaries '{"employerId":9079}'
openweb glassdoor exec getInterviews '{"employerId":9079}'
```
