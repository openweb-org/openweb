# LeetCode

## Overview
Coding challenge and competitive programming platform. Search problems, get daily challenges, browse contests, view user profiles and contest rankings via LeetCode's GraphQL API.

## Workflows

### Explore a user's contest performance
1. `getUserProfile(username)` → profile with ranking, bio
2. `getUserContestRanking(username)` → contest rating, global ranking, history entries with `contest.title`
3. `getContestQuestions(contestSlug)` → questions from a specific contest they entered

### Browse problems and read solutions
1. `searchProblems(keyword)` or `getProblemList(difficulty, topicSlug)` → problems with `titleSlug`
2. `getSolutionArticles(questionSlug)` → community articles sorted by votes

### Review a contest
1. `getContestHistory()` → past contests with `titleSlug`
2. `getContestQuestions(contestSlug)` → questions and point values
3. `getContestRanking(contestSlug, page)` → leaderboard with scores and times

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProblems | search problems by keyword | keyword | title, titleSlug, difficulty, acRate, topicTags | entry point |
| getProblemList | browse problems with filters | difficulty, topicSlug | title, titleSlug, difficulty, acRate, topicTags | entry point; paginated (skip, limit) |
| getDailyChallenge | get today's daily challenge | — | date, question (title, titleSlug, difficulty) | entry point |
| getUserProfile | get user profile and stats | username | ranking, realName, aboutMe, skillTags, reputation | entry point |
| getUserContestRanking | get user contest rating/history | username | rating, globalRanking, topPercentage, history[] | history has contest.title |
| getSubmissions | get submission history for a problem | questionSlug ← searchProblems | id, statusDisplay, lang, runtime, memory | requires login |
| getSolutionArticles | get community solutions | questionSlug ← searchProblems | title, summary, author, hitCount, reactions | paginated (skip, first); sortable |
| getUpcomingContests | get upcoming contests | — | title, titleSlug, startTime, duration | entry point |
| getContestHistory | get past contest list | — | title, titleSlug, startTime, totalQuestions | entry point; paginated |
| getContestQuestions | get questions for a contest | contestSlug ← getContestHistory | credit, title, titleSlug, questionId | |
| getRecentSubmissions | get user's recent AC submissions | username ← getUserProfile | title, titleSlug, timestamp | public; paginated (limit) |
| getContestRanking | get contest leaderboard | contestSlug ← getContestHistory | username, rank, score, finishTime | 25 per page; page starts at 1 |

## Quick Start
```bash
# Today's daily challenge
openweb leetcode exec getDailyChallenge '{}'

# Browse easy problems
openweb leetcode exec getProblemList '{"limit": 5, "difficulty": "EASY"}'

# User profile and contest rating
openweb leetcode exec getUserProfile '{"username": "lee215"}'
openweb leetcode exec getUserContestRanking '{"username": "lee215"}'

# Community solutions for a problem
openweb leetcode exec getSolutionArticles '{"questionSlug": "two-sum", "first": 5}'

# Upcoming contests
openweb leetcode exec getUpcomingContests '{}'

# Contest leaderboard
openweb leetcode exec getContestRanking '{"contestSlug": "weekly-contest-438", "page": 1}'
```

---

## Site Internals

## API Architecture
- **GraphQL-first**: All data served through `leetcode.com/graphql/` POST endpoint
- **Next.js Pages Router**: `_next/data/` routes deliver SSR page props (topic tags, dehydrated state)
- **REST for contest ranking**: `/contest/api/ranking/{slug}/` returns paginated leaderboard
- No bot detection on API — but requires browser context for cookies
- GraphQL operations use named queries with typed variables

## Auth
- Most operations work without auth (`requires_auth: false`)
- `getSubmissions` returns null data without login (LEETCODE_SESSION cookie)
- No CSRF token required for GraphQL queries
- Contest ranking REST endpoint is fully public

## Transport
- `transport: page` — all operations use the `leetcode-graphql` adapter (`adapters/leetcode-graphql.ts`)
- Adapter executes named GraphQL queries via `page.evaluate` fetch to `/graphql/`
- Contest ranking (`getContestRanking`) uses REST endpoint `/contest/api/ranking/{slug}/`
- No PerimeterX or aggressive bot detection; browser context needed for cookie propagation

## Known Issues
- **Search requires login**: `searchProblems` now requires auth (LEETCODE_SESSION cookie) — use `getProblemList` for unauthenticated browsing
- **Submissions require login**: `getSubmissions` returns `null` submissions array when not authenticated
- **Rate limiting**: LeetCode may rate-limit heavy GraphQL usage; no explicit headers documented
- **Premium problems**: `paidOnly: true` problems have restricted content
- **Contest ranking pagination**: 25 results per page, page number starts at 1
