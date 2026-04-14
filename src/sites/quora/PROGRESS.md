# Quora — Progress

## 2026-04-14 — Fix: getProfile ERR_BLOCKED_BY_RESPONSE

**Context:** `pnpm dev verify quora` failed on getProfile with `net::ERR_BLOCKED_BY_RESPONSE` — profile pages now return CORP/COEP headers that block navigation from the existing warm-up page.
**Changes:** getProfile now opens a fresh page via `context.newPage()` (same pattern as searchQuestions) and closes it in a `finally` block. Updated DOC.md Known Issues and Transport sections.
**Verification:** `pnpm dev verify quora` — 4/4 PASS (getAnswers, getProfile, getQuestion, searchQuestions).
**Key discovery:** Quora profile pages enforce Cross-Origin-Resource-Policy headers that block in-page navigation from warm-up pages. Fresh pages bypass this.

## 2026-04-14 — Transport upgrade: GraphQL intercept for answers

**Context:** getQuestion and getAnswers used Tier 2 DOM extraction — fragile CSS selectors, no upvote/view counts, no timestamps, author names from regex.

**Changes:**
- **getQuestion**: Tier 4 (GQL intercept) for top answer previews — intercepts `QuestionPagedListPaginationQuery` during page navigation. Extracts structured author names, credentials, upvotes from GQL. DOM fallback for question metadata (title, topics, follower count) and when GQL doesn't fire.
- **getAnswers**: Tier 4 (GQL intercept) + Tier 5 (page.evaluate(fetch)) for pagination. New response fields: `authorUrl`, `credential`, `views`, `createdAt`. DOM fallback (Tier 2) for questions without enough answers to trigger pagination query.
- **searchQuestions**: Unchanged (Tier 2 DOM — search is SSR-rendered, no GQL query).
- **getProfile**: Unchanged (Tier 2 DOM — no GQL profile query available).
- Updated openapi.yaml with new getAnswers response fields.
- Adapter now uses `AdapterHelpers` interface with `pageFetch`/`graphqlFetch` instead of custom error types.

**Key discoveries:**
- Quora uses Relay-style persisted queries; hashes are deployment-scoped (rotate on deploy)
- GQL responses use multipart format (`--qgqlmpb` boundary) requiring custom parsing
- Formkey extracted from `<script>` tags (not `window.ansFrontendGlobals.formkey`)
- `QuestionPagedListPaginationQuery` only fires for questions with enough answers to paginate
- Search page makes no search-specific GQL call; results are SSR-rendered
- Profile page only has `UserProfileSpacesSection_Paging_Query` (spaces, not profile data)
- `inlineQueryResults` in `window.ansFrontendGlobals.data` contains SSR bootstrap data with qid

**Verification:** All 4 operations pass with `--browser`. GQL path returns structured data (upvotes, views, timestamps). DOM fallback works for questions without pagination query. Build passes, lint clean.

## 2026-04-13 — Fix: search extraction + schema

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (### not ##)
- openapi.yaml: added compiled_at, build verified/signature_id, required arrays on all response objects, descriptions end with periods
- All 4 example files: added replay_safety and response_schema_valid assertion

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify quora` — 3/4 PASS (getQuestion, getAnswers, getProfile); searchQuestions FAIL (GQL interception — query name may have rotated)

## 2026-04-09: Initial add — 4 read operations

**What changed:**
- Added Quora site package: searchQuestions, getQuestion, getAnswers, getProfile
- Adapter-based extraction: GraphQL interception for search, DOM extraction for detail/answers/profile
- Page transport (formkey is page-scoped, GraphQL replay returns null)

**Why:**
- New site addition — Q&A platform with 4 core read operations

**Verification:** Build passes, runtime verify pending

## 2026-04-13 — Fix: search extraction + schema

**Context:** Quora stopped firing `SearchResultsListQuery` GQL during search page navigation; SSR now renders results directly. The warm-up page could also carry stale state into search.
**Changes:** Replaced GQL interception with DOM extraction on a fresh page (avoids warm-up stale state). Made `qid` nullable in openapi.yaml since DOM extraction cannot resolve numeric question IDs. Lint fix: `parseInt` to `Number.parseInt`.
**Verification:** `pnpm build` passes. searchQuestions returns results via DOM extraction.
