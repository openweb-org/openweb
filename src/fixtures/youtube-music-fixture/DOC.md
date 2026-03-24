# YouTube Music Fixture

## Overview

YouTube Music (music.youtube.com) is Google's music streaming platform. All public data is served through the **InnerTube API** at `/youtubei/v1/` — the same API backend used by regular YouTube, but with client name `WEB_REMIX`.

## Architecture

- **Transport**: `page` — browser fetch via same-origin (Google bot detection)
- **API type**: InnerTube REST (POST JSON with context object)
- **Auth**: None for public data; API key extracted from `ytcfg` page global
- **Client**: `WEB_REMIX` (YouTube Music's InnerTube client identifier)
- **API key**: Public key from `ytcfg.get('INNERTUBE_API_KEY')`

## Operations (10)

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| `searchMusic` | `/search` | Search songs, albums, artists, playlists by keyword |
| `getAlbum` | `/browse` | Album details with full track list (browseId: MPREb_...) |
| `getPlaylist` | `/browse` | Playlist details with tracks (browseId: VL...) |
| `getArtist` | `/browse` | Artist page — top songs, albums, singles, videos (channelId: UC...) |
| `getSong` | `/player` | Song metadata — title, artist, duration, view count |
| `getUpNext` | `/next` | Up-next queue, related tracks, lyrics/related browse IDs |
| `getLyrics` | `/next` + `/browse` | Song lyrics with source attribution (auto-resolves from videoId) |
| `browseHome` | `/browse` | Home page recommendation sections |
| `getSearchSuggestions` | `/music/get_search_suggestions` | Search autocomplete suggestions |
| `browseCharts` | `/browse` | Charts — top songs, video charts, genres, top artists |

## Key Patterns

- **InnerTube context**: Every request includes a `context` object with `clientName: WEB_REMIX` and `clientVersion`. The version updates periodically but the API is backward-compatible.
- **Browse IDs**: Albums use `MPREb_` prefix, playlists use `VL` prefix, artists use `UC` channel IDs, special pages use `FEmusic_` prefix (home, explore, charts).
- **Response nesting**: YouTube Music responses are deeply nested with renderer objects. The adapter extracts and flattens the relevant data.
- **Two-column layout**: Albums and playlists use `twoColumnBrowseResultsRenderer` (header in primary, tracks in secondary). Artists and charts use `singleColumnBrowseResultsRenderer`.
- **Lyrics**: Two-step process — first call `/next` to get the lyrics browse ID from tab[1], then call `/browse` with that ID.

## Limitations

- API key and client version are extracted from `ytcfg` page global — requires page to be loaded
- Personalized recommendations require login (home page returns generic content without auth)
- Radio/auto-generated playlists (RDCLAK...) may return limited data without auth
- Client version updates periodically; API remains backward-compatible but version mismatch may affect some features
- No write operations (creating playlists, liking songs requires auth)
