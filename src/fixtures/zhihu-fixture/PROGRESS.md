# Zhihu Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created fixture with 10 operations: searchContent, getUserProfile, getUserAnswers, getHotSearch, getTopicIntro, getTopicFeed, getSimilarQuestions, getRecommendFeed, getUserActivities, getTopicChildren
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md, adapters/zhihu-web.ts

**Why:**
- Zhihu is China's largest Q&A platform — high-value data source for search, profiles, and topic content
- All operations work with browser session cookies (page transport)
- API structure is clean REST with consistent JSON envelope

**Discovery process:**
1. Browsed 10 pages via raw CDP (hot, search x2, question x2, user profile, user answers, topic, billboard, answer detail)
2. Captured 151 API requests with response bodies via Network.loadingFinished + getResponseBody
3. Compiled with `pnpm dev compile` — 46 raw operations from HAR
4. Curated down to 10 operations (removed internal/noise: me, creators, drafts, analytics, tracking)
5. Parameterized paths (url_token, topic_id, question_id) and renamed operations

**Note:** Playwright `connectOverCDP` was blocked by Chrome's `shared_storage_worklet` target type (Playwright 1.58.2 assertion failure). Used raw CDP WebSocket protocol for capture instead.

**Verification:** All 10 operations return 200 with data via browser session (L3). Direct HTTP (L1) fails — cookies required.

**Knowledge updates:** None — Zhihu follows standard Chinese SPA + cookie_session pattern.
