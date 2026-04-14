# Steam Store

## Overview
Gaming marketplace. Game search, details, pricing, user reviews, news, player counts, and achievements via Steam's public APIs.

## Workflows

### Find and research a game
1. `searchGames(term)` → `id`, `name`, `price`, `metascore`
2. `getAppDetails(appids=id)` → full info, `price_overview`, `genres`, `metacritic`, `platforms`
3. `getAppReviews(appid=id)` → `reviews[]` with `review` text, `voted_up`, `author.playtime_forever`; `query_summary.review_score_desc`

### Track a game's community
1. `searchGames(term)` → `id`
2. `getAppNews(appid=id)` → `newsitems[]{title, author, contents, date, feedname}`
3. `getCurrentPlayers(appid=id)` → `player_count`
4. `getGlobalAchievements(gameid=id)` → `achievements[]{name, percent}`

### Browse deals and new releases
1. `getFeatured()` → `large_capsules[]{id, name, discount_percent, final_price}`
2. `getFeaturedCategories()` → `specials`, `top_sellers`, `new_releases`, `coming_soon` each with `items[]{id, name, final_price}`
3. `getAppDetails(appids=id)` → drill into any game from above → full details

### Explore DLC and bundles
1. `getAppDetails(appids=id)` → `data.packages[]` (package IDs), `data.dlc[]` (DLC app IDs)
2. `getDlcForApp(appid=id)` → `dlc[]{id, name, price_overview, platforms}`
3. `getPackageDetails(packageids)` → `name`, `apps[]`, `price`, `platforms`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchGames | search games by keyword | term | id, name, price, metascore, platforms | entry point |
| getAppDetails | full game info | appids ← searchGames.id | name, price_overview, genres, metacritic, platforms, release_date, packages[], dlc[] | supports multiple IDs |
| getAppReviews | user reviews for a game | appid ← searchGames.id | review text, voted_up, author playtime, review_score_desc | paginated (num_per_page, filter) |
| getFeatured | featured/promoted games | — | id, name, discount_percent, final_price, windows/mac/linux_available | entry point |
| getFeaturedCategories | specials, top sellers, new releases | — | category.items[].id, name, discount_percent, final_price | entry point |
| getPackageDetails | bundle/package info | packageids ← getAppDetails.packages[] | name, apps[], price, platforms | |
| getAppNews | news articles for a game | appid ← searchGames.id | title, author, contents, date, feedname, tags | filterable by feed |
| getCurrentPlayers | live player count | appid ← searchGames.id | player_count | |
| getGlobalAchievements | achievement unlock rates | gameid ← searchGames.id | name, percent per achievement | |
| getDlcForApp | DLC listing for a game | appid ← searchGames.id | dlc[].id, name, price, platforms | unverified |
| getPopularTags | all store tags | — | tagid, name | entry point; unverified |

## Quick Start

```bash
# Search for a game
openweb steam exec searchGames '{"term":"elden ring"}'

# Get full game details (Elden Ring = 1245620)
openweb steam exec getAppDetails '{"appids":"1245620"}'

# Get user reviews
openweb steam exec getAppReviews '{"appid":1245620,"num_per_page":5}'

# Get current player count
openweb steam exec getCurrentPlayers '{"appid":730}'

# Get news articles
openweb steam exec getAppNews '{"appid":730,"count":5}'

# Get achievement stats
openweb steam exec getGlobalAchievements '{"gameid":730}'

# Browse featured deals
openweb steam exec getFeatured '{}'

# Browse top sellers and new releases
openweb steam exec getFeaturedCategories '{}'

# Get DLC for a game
openweb steam exec getDlcForApp '{"appid":1245620}'

# Get package/bundle details
openweb steam exec getPackageDetails '{"packageids":"354231"}'

# Get all store tags
openweb steam exec getPopularTags '{}'
```
