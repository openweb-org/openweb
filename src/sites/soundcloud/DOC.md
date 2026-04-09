# SoundCloud

## Overview
Music streaming platform popular with independent artists. Public REST API at api-v2.soundcloud.com for searching tracks, viewing artist profiles, and browsing playlists.

## Workflows

### Find and explore a track
1. `searchTracks(q)` → browse results → pick `id`
2. `getTrack(trackId)` → full details (title, duration, plays, waveform)
3. `getUser(userId)` → artist profile (from `track.user.id`)

### Explore an artist
1. `searchTracks(q)` → find tracks by artist → `user.id`
2. `getUser(userId)` → profile, follower count, track count

### Browse a playlist
1. `getPlaylist(playlistId)` → title, description, embedded track list
2. `getTrack(trackId)` → detail on individual tracks (from `tracks[].id`)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTracks | find tracks by keyword | q | id, title, user, playback_count, duration | entry point, paginated via offset/limit |
| getTrack | full track details | id ← searchTracks | title, duration, plays, likes, waveform_url, genre | includes user object |
| getUser | artist/user profile | id ← track.user.id | username, bio, followers, track_count, verified | |
| getPlaylist | playlist with tracks | id | title, track_count, duration, tracks[] | tracks array embedded |

## Quick Start

```bash
# Search for tracks
openweb soundcloud exec searchTracks '{"q": "lofi beats"}'

# Get track details
openweb soundcloud exec getTrack '{"id": 899253886}'

# Get artist profile
openweb soundcloud exec getUser '{"id": 336200682}'

# Get playlist
openweb soundcloud exec getPlaylist '{"id": 1710939930}'
```

---

## Site Internals

### API Architecture
- Internal REST API at `api-v2.soundcloud.com` (not the legacy public API)
- All endpoints require `client_id` query parameter (public key, same for all users)
- JSON responses, no HTML rendering needed
- Pagination uses `offset`/`limit` params and `next_href` in responses

### Auth
- No user auth required — all operations are public read-only
- `client_id` is a public API key embedded in SoundCloud's JS bundles
- Configured as a `const` schema field (auto-injected by param-validator)
- The client_id can be refreshed from `window.__sc_hydration` → `apiClient.data.id` on soundcloud.com
- Current client_id: `EsIST4DWFy7hEa8mvPoVwdjZ4NTZqmei`

### Transport
- `node` — direct HTTP to api-v2.soundcloud.com
- Bot detection (Cloudflare, DataDome, PerimeterX) protects soundcloud.com but the API subdomain accepts direct requests with valid client_id
- If node transport stops working, switch to `page` transport with `page_global` auth extracting client_id from `window.__sc_hydration`

### Known Issues
- `client_id` rotates when SoundCloud deploys — update the `const` value in openapi.yaml if requests start failing with 401/403
- Large playlists may return partial track data (only IDs for some tracks beyond a threshold)
- The `/resolve` endpoint can convert SoundCloud URLs to API resources but is not exposed as an operation
