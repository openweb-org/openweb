# Quora — Progress

## 2026-04-09: Polish — docs, schema, examples

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
