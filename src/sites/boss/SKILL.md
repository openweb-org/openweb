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
