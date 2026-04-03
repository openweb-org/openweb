# YouTube Music

## Overview
YouTube Music (music.youtube.com) is Google's music streaming platform. Content Platform archetype — all public data served through the InnerTube API.

## Workflows

### Search and play a song
1. `searchMusic(query)` → results with `videoId` per song
2. `getSong(videoId)` → title, artist, duration, view count, thumbnail
3. `getUpNext(videoId)` → related tracks, lyrics browseId

### Explore an artist
1. `searchMusic(query)` → results with artist `browseId` (UC...)
2. `getArtist(browseId)` → top songs, albums, singles, videos, related artists
3. `getAlbum(browseId)` → full track list for an album (MPREb_...)

### Browse an album or playlist
1. `getAlbum(browseId)` → album tracks, artist, year, thumbnail
2. `getPlaylist(browseId)` → playlist tracks, creator, description

### Discover music
1. `browseHome()` → personalized recommendations, new releases
2. `browseCharts()` → top songs, trending, top artists by country

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMusic | search songs/albums/artists | query | sections with videoId, browseId, title, artist | entry point |
| getAlbum | album details + tracks | browseId (MPREb_...) ← searchMusic | title, artist, year, tracks with videoId | |
| getPlaylist | playlist details + tracks | browseId (VL...) ← searchMusic | title, creator, tracks with videoId | |
| getArtist | artist page | browseId (UC...) ← searchMusic | name, subscribers, top songs, albums, singles | |
| getSong | song metadata | videoId ← searchMusic | title, artist, duration, viewCount, thumbnail | |
| getUpNext | related tracks + lyrics ID | videoId ← searchMusic | related tracks, lyrics browseId, autoplay | |
| getSearchSuggestions | search autocomplete | input (partial query) | suggested completions | entry point |
| browseHome | homepage recommendations | — | sections with playlists, new releases | entry point |
| browseCharts | music charts | — | top songs, trending, top artists | entry point |

## Quick Start

```bash
# Search for music
openweb youtube-music exec searchMusic '{"query": "Bohemian Rhapsody"}'

# Get album details
openweb youtube-music exec getAlbum '{"browseId": "MPREb_9nqEki4ZDpp"}'

# Get artist page
openweb youtube-music exec getArtist '{"browseId": "UCiMhD4jzUqG-IgPzUmmytRQ"}'

# Get song metadata
openweb youtube-music exec getSong '{"videoId": "dQw4w9WgXcQ"}'

# Get up-next queue and related tracks
openweb youtube-music exec getUpNext '{"videoId": "dQw4w9WgXcQ"}'

# Get search suggestions
openweb youtube-music exec getSearchSuggestions '{"input": "taylor sw"}'

# Browse homepage
openweb youtube-music exec browseHome '{}'

# Browse charts
openweb youtube-music exec browseCharts '{}'
```

---

## Site Internals

## API Architecture
- **Protocol**: InnerTube REST API (POST JSON)
- **Domain**: `music.youtube.com/youtubei/v1/`
- **Client**: `WEB_REMIX` (YouTube Music's InnerTube client identifier)
- **Pattern**: Every request is POST with JSON body containing `context` (auto-injected) and operation-specific params. API key passed as query param.
- **Browse multiplexing**: The `/youtubei/v1/browse` endpoint serves albums, playlists, artists, home, and charts — differentiated by `browseId` prefix pattern.
- **Response nesting**: Responses use deeply nested renderer objects (e.g., `musicShelfRenderer`, `musicCarouselShelfRenderer`). Consumers should traverse to extract user-facing fields.

## Auth
No auth required for public data. API key (`AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30`) is public and auto-injected as a `const` query parameter.

For personalized results (recommendations, history), Google account login with `sapisidhash` signing would be needed — not currently supported.

## Transport
`node` — InnerTube API accepts direct HTTP requests without cookies or bot detection challenges. No browser needed.

## Known Issues
- **Client version**: Hardcoded to `1.20260327.10.00`. YouTube updates this periodically; the API is backward-compatible but may eventually require a version bump.
- **Deep nesting**: InnerTube responses use complex renderer hierarchies. Raw JSON is large but structured.
- **No write operations**: Creating playlists, liking songs, subscribing require Google account auth (sapisidhash + cookie_session), not currently implemented.
- **Radio playlists**: Auto-generated playlists (RDCLAK...) may return limited data without auth.
