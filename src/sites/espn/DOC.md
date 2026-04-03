# ESPN

## Overview
Sports news, scores, and data. Public REST APIs — no auth required.

## Workflows

### Check live scores for a sport
1. `getScoreboard(sport, league)` → events with teams, scores, status

### Look up a specific team
1. `getTeams(sport, league)` → find `teamId`
2. `getTeam(sport, league, teamId)` → full team detail

### Check league standings
1. `getStandings(sport, league)` → divisions/conferences with team records

### Get latest sports news
1. `getNews(sport, league)` → articles with headlines, descriptions, links

### Search for a player or team
1. `searchPlayers(query, type)` → results with names, links, descriptions

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getScoreboard | live/recent scores | sport, league, dates? | events[].name, competitions[].competitors[].score, status | entry point |
| getTeam | team detail | sport, league, teamId ← getTeams | team.displayName, record, logos | |
| getTeams | list all teams | sport, league | sports[].leagues[].teams[].team.id, displayName | use to find teamId |
| getStandings | league standings | sport, league | children[].standings.entries[].team, stats | may be empty in off-season |
| getNews | sports articles | sport, league | articles[].headline, description, published | |
| searchPlayers | search players/teams | query, type?, limit? | items[].displayName, shortName, type | uses site.web.api.espn.com |

## Quick Start

```bash
# NFL scoreboard
openweb espn exec getScoreboard '{"sport":"football","league":"nfl"}'

# Get NBA teams
openweb espn exec getTeams '{"sport":"basketball","league":"nba"}'

# Get a specific NFL team
openweb espn exec getTeam '{"sport":"football","league":"nfl","teamId":"17"}'

# NFL standings
openweb espn exec getStandings '{"sport":"football","league":"nfl"}'

# NFL news
openweb espn exec getNews '{"sport":"football","league":"nfl"}'

# Search for a player
openweb espn exec searchPlayers '{"query":"Patrick Mahomes","type":"player","limit":5}'
```

---

## Site Internals

## API Architecture
Public REST APIs on `site.api.espn.com` (main) and `site.web.api.espn.com` (search).
Parameterized by sport/league: `/apis/site/v2/sports/{sport}/{league}/{resource}`.

Common sport/league pairs: `football/nfl`, `basketball/nba`, `baseball/mlb`, `hockey/nhl`, `soccer/eng.1`.

## Auth
No auth required. All APIs are public.

## Transport
`node` — direct HTTP. No bot detection observed.

## Known Issues
- Standings may return minimal data during off-season periods.
- The `dates` parameter on getScoreboard uses YYYYMMDD format.
- `searchPlayers` requires the `type` parameter (player or team) to return results — omitting it returns empty.
