# ESPN Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created espn-fixture with 10 operations: getScoreboard, getGameSummary, getNews, getTeams, getTeamDetail, getStandings, getAthlete, getTeamSchedule, getScoreboardHeader, searchESPN
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md

**Why:**
- ESPN is a primary sports data source — scores, stats, schedules are high-value operations
- All 10 operations work without auth via ESPN's internal REST APIs (site.api.espn.com, site.web.api.espn.com)
- ESPN website uses Disney BAMTech auth for streaming/personalized features, but data APIs are fully public

**Discovery process:**
1. Browsed ESPN systematically via Playwright (16 pages: scores for NFL/NBA/MLB/NHL, standings, team pages, player pages, game detail, search, news)
2. Captured 883 requests across 35 snapshots via CDP capture
3. Compiled with `pnpm dev compile` — 16 raw operations generated, 14 verified
4. Curated down to 10 operations: removed noise (auth/watchespn, Disney server components, geo/log/nav, content CMS), renamed operations for clarity
5. Split across two server hosts: site.api.espn.com (8 ops) and site.web.api.espn.com (2 ops — search, scoreboard header)
6. Added known public API endpoints (scoreboard, news, teams, standings, athlete, team schedule, game summary) that ESPN's classic API supports but weren't in the personalized capture

**Verification:** Pending — to be verified via `pnpm dev verify espn-fixture`

**Knowledge updates:** None — ESPN follows standard REST API patterns with no novel auth or extraction.
