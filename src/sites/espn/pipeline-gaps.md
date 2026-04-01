## Pipeline Gaps — ESPN Discovery (2026-04-01)

### False-positive auth detection on public APIs

**Problem:** The compiler detected `cookie_session` auth with a bogus CSRF
(`CURRENT_QUALITY` cookie → `content-length` header) from browser cookies
present during capture. This caused all operations to fail verification
with `auth_drift` (401/403) because the runtime tried to inject cookies
that the API doesn't need.

**Root cause:** `src/compiler/analyzer/auth-candidates.ts` — correlates
any cookie that appears across requests as potential auth. Browser cookies
(preferences, locale, quality settings) are not in the tracking-cookie
denylist and get scored as auth candidates.

**Suggested fix:** Add a confidence penalty when the site's API returns
200 without any cookies (detectable from the captured responses — if all
API responses are 200 regardless of cookies, auth confidence should be
near zero). Alternatively, add `CURRENT_QUALITY`, `edition` preference
cookies to the tracking-cookie denylist.

### Path normalization doesn't merge parameterized sport/league segments

**Problem:** ESPN uses the pattern `/apis/site/v2/sports/{sport}/{league}/{resource}`.
The compiler generated separate operations for each sport/league combo
(e.g., `getApisSiteSportsFootballNflScoreboard`, `getApisSiteSportsBasketballNbaScoreboard`)
instead of recognizing the sport/league segments as path parameters.

**Root cause:** `src/compiler/analyzer/path-normalize.ts` — path segments
are only normalized when they contain numeric or UUID-like patterns. String
segments like `football`, `nfl` are treated as distinct paths.

**Suggested fix:** Add a heuristic: when 2+ paths differ only in 1-2
consecutive segments and share the same suffix, consider those segments
as parameters. E.g., `/sports/football/nfl/scoreboard` and
`/sports/basketball/nba/scoreboard` → `/sports/{param1}/{param2}/scoreboard`.

### Large HAR from full page navigation

**Problem:** Navigating ESPN pages via `page.goto()` generated a 330MB HAR
(static assets, fonts, images, tracking pixels). This exceeded the compiler's
memory limit ("Invalid string length" error). Direct API calls via
`page.evaluate(fetch())` produced an 8.7MB HAR with only API traffic.

**Root cause:** No capture-level filtering of non-API traffic. The labeler
filters during analysis, but the HAR must fit in memory first.

**Suggested fix:** Stream-parse the HAR during analysis (e.g., using a
streaming JSON parser) instead of `JSON.parse()` on the full file. Or
add a `--max-har-size` flag that truncates response bodies during capture.
