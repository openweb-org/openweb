# Boss直聘 Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created boss-fixture with 10 operations: searchJobs, getJobDetail, getCompanyProfile, getCities, getIndustries, getPositionCategories, getFilterConditions, getBusinessDistricts, getSubwayStations, getCityGroups
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md, adapters/boss-web.ts

**Why:**
- Boss直聘 is China's #1 direct-recruiting job platform — job search, salary data, and company info are high-value operations
- 7 reference data APIs work without auth via page.evaluate(fetch)
- 3 page-based operations (search, detail, company) require human-established browser session

**Discovery process:**
1. Browsed zhipin.com via Playwright (homepage, 5 job searches across cities, company list, salary pages)
2. Captured 566 network requests — 670 total entries across tabs
3. Analyzed API structure:
   - `/wapi/zpCommon/data/city.json` — full city hierarchy with codes (912KB)
   - `/wapi/zpCommon/data/industry.json` — 15 industry categories
   - `/wapi/zpCommon/data/getCityShowPosition` — position type hierarchy (320KB)
   - `/wapi/zpgeek/pc/all/filter/conditions.json` — filter options (salary, experience, degree, etc.)
   - `/wapi/zpgeek/businessDistrict.json?cityCode=X` — district hierarchy
   - `/wapi/zpCommon/data/getSubwayByCity?cityCode=X` — subway lines/stations
   - `/wapi/zpCommon/data/cityGroup.json` — A-Z city grouping
4. Confirmed Vue.js SPA architecture — HTML is 8.5KB shell, all content rendered client-side
5. Built L3 adapter with page navigation + DOM extraction for search/detail/company and page.evaluate(fetch) for reference APIs

**Key decisions:**
- All L3 (page transport) — bot detection blocks direct HTTP
- Reference data APIs called via page.evaluate(fetch) from existing page context — no navigation needed
- Search/detail/company use DOM extraction — selectors based on class patterns observed in SPA source
- All API responses use standard format: `{code, message, zpData}`

**Bot detection findings:**
- New Playwright tabs get redirected to about:blank after initial load
- Bot detection clears page content within seconds of SPA initialization
- Reference data APIs still respond — only page rendering is blocked
- Human-established browser sessions work normally

**Verification:** Pending — reference APIs verified via HAR analysis; page operations need human browser session
