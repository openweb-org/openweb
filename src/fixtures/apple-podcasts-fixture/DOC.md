# Apple Podcasts

## Overview
Apple's podcast discovery and listening platform. Search podcasts and episodes, browse show details and episode lists, read user reviews/ratings, and explore top charts by genre — all via the MusicKit amp-api.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPodcasts | search shows by keyword | GET /search | types=podcasts; offset pagination |
| searchEpisodes | search episodes by keyword | GET /search | types=podcast-episodes; offset pagination |
| getPodcastDetails | get show info (name, artist, artwork, feed) | GET /podcasts/{id} | extend=editorialArtwork,feedUrl |
| getPodcastEpisodes | list episodes for a show | GET /podcasts/{id}/episodes | offset pagination; returns audio URL |
| getEpisodeDetails | get single episode detail | GET /podcast-episodes/{id} | includes duration, audio URL, description |
| getPodcastReviews | get user ratings and reviews | GET /podcasts/{id}/reviews | rating (1-5), title, review text, username |
| getTopPodcasts | get top podcast charts | GET /charts | types=podcasts; optional genre filter |
| getTopEpisodes | get top episode charts | GET /charts | types=podcast-episodes; optional genre filter |
| getGenreCharts | get top podcasts by genre | GET /charts | genre={genreId}; e.g. 1303=Comedy |
| searchAll | combined search (shows + episodes) | GET /search/groups | grouped results with top, shows, episodes sections |

## API Architecture
- **MusicKit amp-api**: REST API at `amp-api.podcasts.apple.com/v1/catalog/{storefront}/`
- **Auth**: Bearer token (JWT developer token from MusicKit JS — not user auth)
- **Pagination**: Offset-based — responses include `next` URL or use `offset` param
- **Response shape**: `{ data: [...] }` for detail, `{ results: { type: { data: [...] } } }` for search/charts
- **Resource types**: `podcasts`, `podcast-episodes`, `user-reviews`

## Auth
- Developer token obtained from `MusicKit.getInstance().developerToken` in browser context
- No user login required (`requires_auth: false`)
- Token is a public JWT signed by Apple, embedded in MusicKit JS bundle
- Token rotates periodically — always fetch fresh from MusicKit instance

## Transport
- `transport: page` — browser fetch for all operations
- Bearer token only available in browser context where MusicKit JS is loaded
- Must navigate to podcasts.apple.com first to initialize MusicKit
- Direct HTTP without token returns 401

## Extraction
- **Adapter-based**: All operations use the `apple-podcasts-api` adapter
- amp-api returns structured JSON — no DOM parsing needed
- Podcast attributes: name, artistName, artwork, description, genreNames, trackCount, feedUrl
- Episode attributes: name, description, durationInMilliseconds, assetUrl, releaseDateTime
- Review attributes: rating, title, review, userName, date

## Known Issues
- **Token dependency**: MusicKit JS must be initialized (page must load podcasts.apple.com)
- **No categories endpoint**: `/categories` returns 500 — genre info available via genreNames on podcasts
- **Chart names vary**: Charts return names like "Top Series", "Top Episodes" — not customizable
- **Genre IDs**: Must use Apple genre IDs (e.g. 1303=Comedy, 1318=Technology, 1301=Arts)
- **Rate limiting**: Heavy API usage may trigger temporary blocks
- **Storefront**: Hardcoded to `us` — other storefronts possible by changing catalog path
