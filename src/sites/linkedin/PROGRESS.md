## 2026-04-01: Initial discovery and compilation

**What changed:**
- Discovered LinkedIn Voyager REST + GraphQL API via browser capture
- Compiled 13 operations: getMe, getProfile, getProfileByUrn, getFeed, searchClusters, getConnectionsSummary, getInvitations, getNotificationCards, getConversations, getNewsStorylines, getCompany, getMyNetworkNotifications, getMailboxCounts
- Configured cookie_session auth with JSESSIONID CSRF (all methods)
- Curated from 58 auto-detected operations, removed noise (tracking, premium upsell, internal config, onboarding, realtime infra)

**Why:**
- Net-new site discovery targeting core LinkedIn functionality for agents

**Verification:** Compile-time verify 1/76 PASS (auth_drift expected — cookies expired after capture). Runtime verify pending with active browser session.

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C of the adapter normalization effort — converge all site adapters on the `CustomRunner` shape so the runtime has a single entry point per adapter.
**Changes:** Migrated `adapters/linkedin-graphql.ts` from `CodeAdapter` to `CustomRunner` (single `run(ctx)`). Dropped `init()` (only checked `page.url().includes('linkedin.com')`, redundant with PagePlan) and `isAuthenticated()` (only checked `li_at` cookie presence, no server probe — runtime auth-primitive resolution already covers this). All 6 op handlers (getProfile, getFeed, getCompany, getNewsStorylines, searchJobs, getJobDetail) preserved byte-for-byte, including queryId cache, GraphQL/REST helpers, JSESSIONID→csrf-token extraction, and Rest.li tuple formatting. 283 → 282 lines.
**Verification:** 12/12 ops PASS.
**Key files:** `src/sites/linkedin/adapters/linkedin-graphql.ts` (commit 45674b6).

## 2026-04-23 — Fix job search: geoId, descriptions, geo lookup

**Context:** While searching for ultrasound jobs in the SF Bay Area, discovered two bugs and a missing operation.

**Changes:**
1. **Fix geoId docs**: `102571732` was documented as "San Francisco Bay Area" but is actually "New York, New York, United States". The correct SF Bay Area geoId is `90000084`. Fixed in `openapi.yaml` parameter description.
2. **Fix getJobDetail descriptions**: Added `JOB_DESCRIPTION_CARD` to `cardSectionTypes` in the adapter. Previously only `TOP_CARD,HOW_YOU_FIT_CARD` were requested, so job descriptions were never returned. Now responses include `com.linkedin.voyager.dash.jobs.JobDescription` with full description text.
3. **Add searchGeo operation**: New `searchGeo(keywords)` operation to look up LinkedIn geoIds by location name. Uses `voyagerSearchDashReusableTypeahead` REST endpoint with `q=type&type=GEO`. Returns geo entities with `entityUrn` containing the geoId (e.g. `urn:li:fsd_geo:90000084` → geoId `90000084`). Uses `restGet` directly rather than GraphQL queryId resolution, because the typeahead service uses REST.li registration (not the `kind:"query"` pattern that `loadQueryIds` scans).

**Key discoveries:**
- LinkedIn job detail pages migrated to SDUI (Server-Driven UI / React Server Components) — data loads via `/flagship-web/rsc-action/actions/component` endpoints, not Voyager GraphQL. However, the Voyager `full-job-posting-detail-section` API still works.
- The `full-job-posting-detail-section` queryId is only registered in jobs page bundles, not feed page bundles. The `cachedQueryIds` populated from a feed page won't have it — but the adapter's bundle scan covers all bundles on whatever page is loaded.

**Verification:** 13/13 ops verified.
**Key files:** `src/sites/linkedin/adapters/linkedin-graphql.ts`, `src/sites/linkedin/openapi.yaml`.
