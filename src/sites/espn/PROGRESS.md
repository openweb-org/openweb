## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered ESPN public sports APIs at site.api.espn.com
- Compiled 6 operations: getScoreboard, getTeam, getTeams, getStandings, getNews, searchPlayers
- Parameterized paths by sport/league for multi-sport coverage
- No auth needed — all APIs are public

**Why:**
- User requested ESPN site package with sports data operations

**Verification:** API-level (all endpoints return 200), spec review, doc review
