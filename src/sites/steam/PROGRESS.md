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

## 2026-04-13 — Schema Fix

**Context:** getFeatured response `large_capsules` items may omit certain fields depending on sale state or content type.
**Changes:** openapi.yaml — removed `required` constraint on `large_capsules` array items.
**Verification:** Verify pass — schema now aligns with observed response variance.

## 2026-04-24 — Adapter QA: response trimming for all 11 ops

**Context:** Userflow QA across 3 personas revealed that 7 of 11 operations exceeded the 4KB inline threshold, causing responses to spill to temp files. Agent consumers can't read file-based responses, making most ops unusable.

**Personas tested:**
1. Gamer browsing top sellers → getFeaturedCategories → getAppDetails → getAppReviews → getCurrentPlayers
2. Indie enthusiast → searchGames → getAppDetails → getAppReviews(positive) → getPopularTags
3. Parent buying co-op game → searchGames("co-op") → getAppDetails → getDlcForApp

**Problems found:**

| Severity | Issue | Ops affected |
|----------|-------|-------------|
| P0 | Response bloat → file spill (>4KB) | 7 of 11: getAppDetails (15KB), getAppReviews (38KB), getFeaturedCategories (49KB), getFeatured (23KB), getAppNews (14KB), getPopularTags (15KB), getPackageDetails |
| P1 | `json=1` required param is implementation detail | getAppReviews |
| P1 | Schema didn't allow null for optional fields | getAppDetails (metacritic, recommendations, price_overview), getDlcForApp (price_overview) |
| P2 | Multi-app appids returns null/400 | getAppDetails (Steam API limitation, not fixable) |
| P2 | Search is name-based only, not tag-based | searchGames (Steam API limitation) |

**Changes:**

1. **New adapter** `src/sites/steam/adapters/steam.ts` (215 lines)
   - Handles all 11 operations with nodeFetch
   - Auto-injects `json=1` for getAppReviews
   - Preserves commas in query string values (Steam multi-value params)
   - Trimming per operation:
     - `getAppDetails`: drops HTML descriptions, screenshots, movies, images, packages → ~1KB
     - `getAppReviews`: strips hardware{18 fields}, reactions, redundant author fields, caps review text at 2000 chars
     - `getFeaturedCategories`: drops numeric promo keys (0-6), genres, trailerslideshow; limits 5 items/category; strips images
     - `getFeatured`: limits 5 items/platform; strips images and streaming field
     - `getAppNews`: limits 5 items, caps contents at 300 chars, drops feed_type/is_external_url
     - `getPopularTags`: limits to top 100 tags (was 446)
     - `getDlcForApp`: strips header_image
     - `getPackageDetails`: strips page_image
     - `searchGames`, `getCurrentPlayers`, `getGlobalAchievements`: pass-through (already inline)

2. **OpenAPI spec updates** `openapi.yaml`
   - Added `adapter: { name: steam, operation: <op> }` to all 11 x-openweb blocks
   - Made `json` param not required for getAppReviews (adapter auto-injects)
   - Allowed null for: metacritic, recommendations, price_overview (getAppDetails + getDlcForApp)
   - Relaxed query_summary required fields (Steam omits some on filtered queries)
   - Removed `large_capsules` from getFeatured required
   - Removed `id` from category objects, dropped genres/trailerslideshow from getFeaturedCategories
   - Removed `status` from getDlcForApp required

**Verification:** `pnpm dev verify steam` → 9/9 PASS. All 11 ops return inline JSON (under 4KB). Three persona workflows complete end-to-end with no friction.

**Known limitations (Steam API, not fixable):**
- Multi-app `appids` parameter (comma-separated) returns null — use single appid per request
- `searchGames` matches game names only, not tags — search "co-op" returns games with "co-op" in the title, not all co-op games
