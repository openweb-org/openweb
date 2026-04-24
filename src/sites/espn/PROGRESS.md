## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered ESPN public sports APIs at site.api.espn.com
- Compiled 6 operations: getScoreboard, getTeam, getTeams, getStandings, getNews, searchPlayers
- Parameterized paths by sport/league for multi-sport coverage
- No auth needed — all APIs are public

**Why:**
- User requested ESPN site package with sports data operations

**Verification:** API-level (all endpoints return 200), spec review, doc review

## 2026-04-24: Userflow QA — 3 persona workflows

**Personas tested:**
1. Fantasy football manager — NFL scores, player search, injury news, team detail
2. Basketball fan — NBA standings, scoreboard, news, team detail, team list
3. Soccer fan — Premier League scores, standings, news, teams, player search

**Bugs found and fixed:**
1. `searchPlayers` returned empty for all queries (Mahomes, Salah, LeBron). Root cause: ESPN API requires `type` query param (player/team) but it was marked `required: false` with no default. Fix: added `default: player` to the type param schema.
2. All 6 operations returned massively bloated responses (logos arrays with 4-17 variants, full links arrays, calendar data, season metadata, UIDs). Response sizes ranged from 8KB to 170KB. Fix: added `src/sites/espn/adapters/espn.ts` adapter wired to all 6 ops.

**Response size improvements (before → after):**
| Operation | Before | After | Reduction |
|-----------|--------|-------|-----------|
| NFL scoreboard | 12KB | ~1.5KB | 88% |
| NBA scoreboard | 75KB | ~3KB | 96% |
| PL scoreboard | 15KB | ~1KB | 93% |
| NFL teams | 148KB | 5.7KB | 96% |
| NBA teams | 134KB | 5.3KB | 96% |
| NFL standings | 156KB | 39KB | 75% |
| NBA standings | 170KB | 42KB | 75% |
| PL standings | 69KB | 17KB | 75% |
| NFL news | 55KB | 8.4KB | 85% |
| NBA news | 26KB | 4.3KB | 83% |
| NFL team | 8KB | ~0.5KB | 94% |
| NBA team | 21KB | ~0.5KB | 98% |
| searchPlayers | 13KB | ~0.3KB | 98% |

**Adapter trim strategy:**
- Logos: keep first default href only
- Links: removed entirely (internal ESPN navigation)
- Calendar/season metadata: removed
- UIDs, GUIDs, slugs: removed
- Stats: keep name + value + displayValue only
- News categories: keep type + description for league/team/athlete only
- News images: keep first image url + caption only
- Search results: flatten team from nested relationships to simple name string

**Verification:** `pnpm dev verify espn` — 7/8 PASS, 1 benign DRIFT (getScoreboard.day absent during NFL offseason). Zero schema warnings. All 3 persona workflows complete successfully.
