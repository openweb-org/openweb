# LeetCode

## Overview
Coding challenge and competitive programming platform. Search problems, get daily challenges, browse contests, view user profiles and contest rankings via LeetCode's GraphQL API.

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

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProblems | search problems by keyword | GraphQL | keyword search across all problems |
| getProblemList | browse problems with filters | GraphQL | filter by difficulty, topic tag; paginated |
| getDailyChallenge | get today's daily challenge | GraphQL | one problem per day, no params |
| getUserProfile | get user profile and stats | GraphQL | public profile: ranking, bio, social links |
| getUserContestRanking | get user contest rating/history | GraphQL | contest rating, global ranking, history |
| getSubmissions | get submission history for a problem | GraphQL | requires login; returns runtime, language, status |
| getSolutionArticles | get community solutions | GraphQL | articles sorted by popularity/votes |
| getUpcomingContests | get upcoming contests | GraphQL | weekly and biweekly contest schedule |
| getContestHistory | get past contest list | GraphQL | paginated history with question counts |
| getContestQuestions | get questions for a contest | GraphQL | problem list with point values |
| getRecentSubmissions | get user's recent AC submissions | GraphQL | public; recent accepted problems |
| getContestRanking | get contest leaderboard | REST | ranks, scores, finish times per page |

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
- `transport: page` — browser fetch for all operations
- GraphQL requires `Content-Type: application/json` header
- No PerimeterX or aggressive bot detection; browser context needed for cookie propagation

## Extraction
- **Adapter-based**: All operations use the `leetcode-graphql` adapter
- GraphQL queries return structured JSON directly — no DOM parsing needed
- Contest ranking uses REST endpoint with JSON response, transformed in adapter

## Known Issues
- **Search requires login**: `searchProblems` now requires auth (LEETCODE_SESSION cookie) — use `getProblemList` for unauthenticated browsing
- **Submissions require login**: `getSubmissions` returns `null` submissions array when not authenticated
- **Rate limiting**: LeetCode may rate-limit heavy GraphQL usage; no explicit headers documented
- **Premium problems**: `paidOnly: true` problems have restricted content
- **Contest ranking pagination**: 25 results per page, page number starts at 1
