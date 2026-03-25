# ESPN

## Overview
Sports data platform. Live scores, game summaries, team/player info, standings, news, and search across NFL, NBA, MLB, NHL, soccer, and more via ESPN's internal REST APIs.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getScoreboard | live/recent scores by sport | GET /apis/site/v2/sports/{sport}/{league}/scoreboard | returns events with competitors, scores, status; filter by date |
| getGameSummary | game detail/boxscore | GET /apis/site/v2/sports/{sport}/{league}/summary?event={id} | full boxscore, scoring plays, leaders, player stats |
| getNews | sport news headlines | GET /apis/site/v2/sports/{sport}/{league}/news | articles with headline, description, images, categories |
| getTeams | list all teams | GET /apis/site/v2/sports/{sport}/{league}/teams | all teams in a league with logos, colors, links |
| getTeamDetail | team info | GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId} | record, next event, standing summary, franchise info |
| getStandings | league standings | GET /apis/v2/sports/{sport}/{league}/standings | grouped by division/conference with win/loss stats |
| getAthlete | player bio/stats | GET /apis/site/v2/sports/{sport}/{league}/athletes/{athleteId} | bio, position, team, career statistics |
| getTeamSchedule | team schedule | GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule | season games with scores, opponents, status |
| getScoreboardHeader | compact score ticker | GET /apis/site/v2/scoreboard/header | quick scores across all sports (via site.web.api.espn.com) |
| searchESPN | search everything | GET /apis/search/v2?query={q} | athletes, teams, articles, videos (via site.web.api.espn.com) |

## API Architecture
- **Two API hosts**: `site.api.espn.com` (8 operations) and `site.web.api.espn.com` (2 operations — search, scoreboard header)
- Internal APIs used by ESPN's website and mobile apps — no official public documentation
- All operations are public (no auth required)
- Path pattern: `/apis/site/v2/sports/{sport}/{league}/...` for most sport-specific data
- Common sport/league slugs: football/nfl, basketball/nba, baseball/mlb, hockey/nhl, soccer/eng.1

## Auth
- No auth needed for any operation
- `requires_auth: false`
- ESPN website uses JWT tokens and Disney BAMTech auth for personalized/streaming features, but data APIs are fully public

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No bot detection on the API subdomains (site.api.espn.com, site.web.api.espn.com)
- API responses are clean JSON

## Extraction
- All operations return JSON directly — no SSR extraction needed
- Response schemas use nested objects extensively (events → competitions → competitors → team)

## Known Issues
- **Offseason data** — scoreboard returns empty events array when no games are scheduled (e.g. NFL in March)
- **Team/athlete IDs** — numeric IDs are not predictable; use getTeams or searchESPN to discover IDs
- **Standings may 404** — some leagues don't support the standings endpoint (e.g. individual sports)
- **Sport/league slugs** — must use exact slugs (football not nfl, then nfl as league). Common pairs: football/nfl, basketball/nba, baseball/mlb, hockey/nhl, soccer/eng.1
