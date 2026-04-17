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
