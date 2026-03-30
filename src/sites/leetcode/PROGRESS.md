# LeetCode Fixture — Progress

## 2026-03-30: Schema fixes + full QA

**What changed:**
- Fixed 3 failing ops in openapi.yaml: inlined broken `$ref` to ProblemSummary (validator couldn't resolve), fixed getDailyChallenge `question.id` type (integer to string), marked searchProblems as auth-required
- Added 12 example files (one per operation) in `examples/`
- Added Quick Start CLI examples to DOC.md, updated Known Issues for searchProblems auth
- Unquarantined site after successful verification

**Why:**
- 3/12 ops were failing verify: getProblemList ($ref resolution), getDailyChallenge (schema mismatch), searchProblems (now requires login)
- Site was quarantined — needed schema alignment with actual API responses to pass verification

**Verification:** 11/12 PASS, 1 DRIFT (getSubmissions — auth-required, pre-existing). getDailyChallenge, getProblemList, searchProblems all fixed from FAIL to PASS.

## 2026-03-24: Initial discovery — 12 operations

**What changed:**
- Created leetcode with 12 operations: searchProblems, getProblemList, getDailyChallenge, getUserProfile, getUserContestRanking, getSubmissions, getSolutionArticles, getUpcomingContests, getContestHistory, getContestQuestions, getRecentSubmissions, getContestRanking

**Why:**
- LeetCode is the leading competitive programming platform — problem search, contests, user profiles
- 11 of 12 operations work without auth via GraphQL API; getSubmissions requires login
- No aggressive bot detection; browser context needed for cookie propagation

**Discovery process:**
1. Browsed homepage, problemset (with search/filters), problem detail pages, contest pages, user profiles, study plans
2. Captured 219 GraphQL requests across 16 distinct operation types
3. Selected 11 GraphQL operations covering core user intents: problem discovery, contest info, user profiles, solutions
4. Added 1 REST operation for contest ranking (`/contest/api/ranking/`)
5. Built adapter with `page.evaluate(fetch(...))` pattern for all GraphQL and REST calls
6. Modeled response schemas from captured traffic samples

**Verification:** Content-level verification confirmed: problemsetQuestionListV2 returns full problem list with Two Sum as #1 (difficulty: EASY, acRate present), questionOfTodayV2 returns daily challenge (date: 2026-03-24), userPublicProfile returns lee215 profile (ranking, bio, Guardian badge), contestV2UpcomingContests returns weekly-contest-495 with startTime, contestQuestionList returns 4 questions for weekly-contest-438 with point values.

**Knowledge updates:** LeetCode uses Next.js Pages Router with GraphQL-first data layer. All problem/contest/profile data served through `/graphql/` POST endpoint. No CSRF token needed for read queries. Contest ranking is the only REST endpoint (`/contest/api/ranking/`). No PerimeterX/DataDome bot detection on API endpoints.
