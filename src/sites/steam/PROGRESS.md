# Steam — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created steam with 10 operations: getAppDetails, searchGames, getAppReviews, getFeatured, getFeaturedCategories, getPackageDetails, getAppNews, getCurrentPlayers, getGlobalAchievements, getAppNewsV1
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md

**Why:**
- Steam is the largest PC gaming marketplace — game search, pricing, reviews, and player stats are high-value operations
- All 10 operations work without auth via Steam's public APIs (store.steampowered.com/api/ and api.steampowered.com)
- Steam has separate API key-gated endpoints for player profiles and inventory, but store/news/stats APIs are fully public

**Discovery process:**
1. Planned 10 target operations covering core user intents: search, game details, reviews, featured/specials, news, player counts, achievements
2. Browsed Steam via Playwright — visited store homepage, search pages, game detail pages, and API endpoints directly
3. Verified all 9 API endpoints return valid JSON (applist v2 was removed by Valve, replaced with getAppNewsV1)
4. Created site manually (public API pattern, same as coingecko) — no capture compilation needed
5. Split across two server hosts: store.steampowered.com (6 ops) and api.steampowered.com (4 ops — ISteamNews, ISteamUserStats)

**Verification:** All 10 endpoints confirmed returning valid JSON via browser-based testing.

**Knowledge updates:** None — Steam follows standard public REST API patterns with no novel auth or extraction.
