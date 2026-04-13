# Steam Store

## Overview
Gaming marketplace. Game search, details, pricing, user reviews, news, player counts, and achievements via Steam's public APIs.

## Workflows

### Find and research a game
1. `searchGames(term)` → pick game → `id`
2. `getAppDetails(appids=id)` → full info, price, genres, metacritic
3. `getAppReviews(appid=id)` → user reviews, score summary

### Track a game's community
1. `searchGames(term)` → `id`
2. `getAppNews(appid=id)` → news articles
3. `getCurrentPlayers(appid=id)` → live player count
4. `getGlobalAchievements(gameid=id)` → achievement unlock rates

### Browse deals and new releases
1. `getFeatured()` → promoted games with discounts
2. `getFeaturedCategories()` → specials, top sellers, new releases, coming soon
3. `getAppDetails(appids=id)` → drill into any game

### Explore DLC and bundles
1. `getAppDetails(appids=id)` → find package IDs from game info
2. `getDlcForApp(appid=id)` → list all DLC for a game
3. `getPackageDetails(packageids=id)` → bundle contents and pricing

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchGames | search games by keyword | term | id, name, price, metascore, platforms | entry point |
| getAppDetails | full game info | appids ← searchGames | name, price_overview, genres, metacritic, platforms, release_date | supports multiple IDs |
| getAppReviews | user reviews for a game | appid ← searchGames | review text, voted_up, author playtime, review_score_desc | paginated (num_per_page, filter) |
| getFeatured | featured/promoted games | — | id, name, discount_percent, final_price, windows/mac/linux_available | entry point |
| getFeaturedCategories | specials, top sellers, new releases | — | category.items[].id, name, discount_percent, final_price | entry point |
| getPackageDetails | bundle/package info | packageids ← getAppDetails | name, apps[], price, platforms | |
| getAppNews | news articles for a game | appid ← searchGames | title, author, contents, date, feedname, tags | filterable by feed |
| getCurrentPlayers | live player count | appid ← searchGames | player_count | |
| getGlobalAchievements | achievement unlock rates | gameid ← searchGames | name, percent per achievement | |
| getDlcForApp | DLC listing for a game | appid ← searchGames | dlc[].id, name, price, platforms | unverified |
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
