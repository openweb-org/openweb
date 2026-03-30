## 2026-03-27: Initial compile — 5 target intents

**What changed:**
- Compiled 71 HTTP operations from LinkedIn Voyager API
- Auth: cookie_session + cookie_to_header CSRF (JSESSIONID → csrf-token)
- Transport: page (bot detection requires browser context)
- Fixed CSRF auto-detection (was picking locale cookie, overridden to JSESSIONID)
- Fixed URL encoding: buildTargetUrl now uses minimal encoding to preserve ( ) , characters
- Fixed GraphQL variables parameter: array → string type for comma-separated values
- Fixed URN encoding in test fixtures: colons inside URN values must be percent-encoded

**Why:**
- Initial LinkedIn discovery for 5 target intents: search people, search jobs, search content, get person profile, get job details

**Verification:** all 5 target intents return real data via exec
- voyager_identity_profiles → 200 (search/get person)
- list_voyager_voyagerjobsdashjobcards → 200 (search jobs, 35KB)
- voyager_lego_page_contents → 200 (search content)
- get_voyager_identity_normalizedprofile → 200 (person profile)
- voyager_jobs_job_postings → 200 (job details, 58KB)
