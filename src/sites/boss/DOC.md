# Boss直聘 (BOSS Zhipin)

## Overview
China's leading direct-recruiting job platform. Job seekers chat directly with bosses/HR. Search jobs, view job details with salary info, explore company profiles, and access comprehensive reference data (cities, industries, position categories).

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchJobs | search jobs by keyword & city | page /web/geek/job | Vue SPA — extracts job cards from rendered DOM; requires browser session |
| getJobDetail | get full job posting | page /job_detail/{id} | salary, description, requirements, company info, boss info from DOM |
| getCompanyProfile | get company profile | page /gongsi/{id} | company info, description, open positions from DOM |
| getCities | get all cities with codes | fetch /wapi/zpCommon/data/city.json | hot cities + province-grouped hierarchy; 912KB |
| getIndustries | get industry categories | fetch /wapi/zpCommon/data/industry.json | 15 top-level industries with sub-categories |
| getPositionCategories | get job position types | fetch /wapi/zpCommon/data/getCityShowPosition | hierarchical: category → subcategory → specific positions |
| getFilterConditions | get search filter options | fetch /wapi/zpgeek/pc/all/filter/conditions.json | salary ranges, experience, degree, company stage/size, job type |
| getBusinessDistricts | get districts for a city | fetch /wapi/zpgeek/businessDistrict.json | district → sub-area hierarchy for location filtering |
| getSubwayStations | get subway for a city | fetch /wapi/zpCommon/data/getSubwayByCity | subway lines and stations for commute-based filtering |
| getCityGroups | get cities grouped A-Z | fetch /wapi/zpCommon/data/cityGroup.json | alphabetically grouped city list |

## API Architecture
- **Vue.js SPA**: `/web/geek/job` serves an ~8.5KB HTML shell; all content rendered client-side
- **Internal REST APIs**: `/wapi/zpCommon/*` and `/wapi/zpgeek/*` for reference data (cities, industries, positions, filters)
- **Response format**: All APIs return `{"code": 0, "message": "Success", "zpData": ...}`
- **Bot detection**: Strong automation detection — new Playwright pages get redirected to `about:blank`. Reference data APIs work via `page.evaluate(fetch)` but search/detail pages require human-established browser session.
- **City codes**: All search operations use numeric city codes (e.g. 101010100 = Beijing, 101020100 = Shanghai)

## Auth
- Reference data APIs (cities, industries, positions, filters) work without auth
- Job search and detail pages need an active browser session with valid cookies (`__zp_stoken__`)
- Some APIs return `{"code":7,"message":"当前登录状态已失效"}` when not logged in
- `requires_auth: false` — core reference data works without login

## Transport
- `page` (L3 adapter) — all operations via page context
- Page operations (searchJobs, getJobDetail, getCompanyProfile) use DOM extraction after navigation
- Reference data operations use `page.evaluate(fetch)` to call APIs from browser context
- Cannot downgrade to `node` — bot detection blocks direct HTTP requests

## Known Issues
- **Bot detection**: New automated tabs may get blanked by bot detection. Adapter works best in a browser session where a human has already passed verification.
- **SPA rendering timing**: Job search results load asynchronously via Vue.js; 5-second wait may not be sufficient under slow connections.
- **DOM selectors may drift**: Boss直聘 updates its frontend frequently. CSS class names may change.
- **Large reference data**: city.json is 912KB, getCityShowPosition is 320KB — consider caching.
