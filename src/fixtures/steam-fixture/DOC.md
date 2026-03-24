# Steam Store

## Overview
Gaming marketplace. Game search, details, pricing, user reviews, news, player counts, and achievements via Steam's public APIs at store.steampowered.com/api/ and api.steampowered.com.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getAppDetails | full game info by app ID | GET /api/appdetails?appids={id} | price, description, genres, screenshots, metacritic, platforms |
| searchGames | search games by keyword | GET /api/storesearch/?term={q} | returns matching apps with price and platform info |
| getAppReviews | user reviews for a game | GET /appreviews/{appid}?json=1 | review text, scores, author playtime, vote counts |
| getFeatured | featured/promoted games | GET /api/featured/ | homepage featured games with pricing |
| getFeaturedCategories | category lists (specials, top sellers, new releases) | GET /api/featuredcategories/ | specials, coming_soon, top_sellers, new_releases |
| getPackageDetails | bundle/package info | GET /api/packagedetails?packageids={id} | apps included, pricing, platforms |
| getAppNews | news articles for a game | GET /ISteamNews/GetNewsForApp/v2/ (api.steampowered.com) | title, author, contents, date |
| getCurrentPlayers | current online player count | GET /ISteamUserStats/GetNumberOfCurrentPlayers/v1/ (api.steampowered.com) | real-time player count |
| getGlobalAchievements | achievement unlock percentages | GET /ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/ (api.steampowered.com) | name + percent for each achievement |
| getAppNewsV1 | news with tags and feed filter | GET /ISteamNews/GetNewsForApp/v1/ (api.steampowered.com) | v1 adds tags array and feed filter param |

## API Architecture
- **Two API hosts**: `store.steampowered.com` (6 operations — store APIs) and `api.steampowered.com` (4 operations — Steamworks Web API)
- Store APIs: `/api/appdetails`, `/api/storesearch/`, `/api/featured/`, `/api/featuredcategories/`, `/api/packagedetails`, `/appreviews/{appid}`
- Steamworks APIs: ISteamNews, ISteamUserStats interfaces with versioned methods
- All operations are public (no API key required for these endpoints)

## Auth
- No auth needed for any operation
- `requires_auth: false`
- Steam does have an API key system for other endpoints (player profiles, inventory) but store/news/stats APIs are fully public

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No bot detection on API endpoints
- API responses are clean JSON

## Extraction
- All operations return JSON directly — no SSR extraction needed
- appdetails wraps response in `{ "appid": { success: bool, data: {...} } }` keyed by app ID
- packagedetails uses same wrapper pattern

## Known Issues
- **appdetails rate limiting** — Steam may rate-limit rapid appdetails requests; space out bulk lookups
- **Package IDs** — not easily discoverable; use appdetails to find package IDs from a known app
- **Regional pricing** — use `cc` parameter for correct local pricing; defaults to US
- **Free games** — `is_free: true` games have no `price_overview` field in appdetails
- **Age-gated content** — some appdetails may return `success: false` for age-restricted apps without cookies
