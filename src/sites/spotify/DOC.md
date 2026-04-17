# Spotify

## Overview
Music streaming platform. Content platform archetype.

## Workflows

### Search and explore artist
1. `searchMusic(searchTerm)` → artists, tracks, albums with URIs
2. `getArtist(uri)` → profile, stats, top tracks, related artists
3. `getArtistDiscography(uri)` → full album/single catalog
4. `getAlbumTracks(uri)` → individual track listing

### Track deep dive
1. `searchMusic(searchTerm: "bohemian rhapsody")` → pick track `uri`
2. `getTrack(uri)` → name, play count, album, artists, duration
3. `getRecommendations(uri)` → similar tracks

### Playlist exploration
1. `searchMusic(searchTerm: "top hits")` → find playlist URI from results
2. `getPlaylist(uri)` → playlist name, description, followers, track list
3. `getTrack(uri)` → deep dive into any track from the playlist

### User playlist discovery
1. `getUserPlaylists(userId: "spotify")` → user's public playlists with follower counts
2. `getPlaylist(uri)` → full playlist details and tracks

### Library management (requires login)
1. `searchMusic(searchTerm: "bohemian rhapsody")` → pick track `uri`, extract track ID
2. `likeTrack(trackId)` → save track to Liked Songs
3. `unlikeTrack(trackId)` → remove from Liked Songs

### Playlist curation (requires login)
1. `createPlaylist(name, description, public)` → new playlist with URI
2. `searchMusic(searchTerm)` → find tracks to add
3. `addToPlaylist(playlistId, trackUris)` → add tracks to playlist
4. `removeFromPlaylist(playlistId, trackUris)` → remove tracks from playlist

### Quick artist lookup
1. `searchMusic(searchTerm: "radiohead")` → pick artist `uri`
2. `getArtist(uri: "spotify:artist:4Z8W4fKeB5YxbusRsdQVPb")` → name, followers, top tracks

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMusic | search across types | searchTerm | artists, tracks, albums with URIs | entry point |
| getArtist | artist profile + stats | uri ← searchMusic | name, followers, monthlyListeners, topTracks, albums | includes related artists |
| getArtistDiscography | full discography | uri ← searchMusic | albums, singles, compilations with dates | paginated |
| getAlbumTracks | album track list | uri ← getArtist/getArtistDiscography | track names, playcounts, durations | |
| getTrack | track details | uri ← searchMusic/getAlbumTracks | name, playcount, album, artists, duration, content rating | includes album art |
| getPlaylist | playlist details + tracks | uri ← searchMusic/getUserPlaylists | name, description, followers, owner, track list | paginated |
| getUserPlaylists | user's public playlists | userId | playlist names, URIs, follower counts, images | REST endpoint |
| getRecommendations | similar tracks | uri ← searchMusic/getTrack | recommended track names, URIs, artists, play counts | seed-based |
| likeTrack | save to Liked Songs | trackId ← searchMusic/getTrack | success | write, requires login |
| unlikeTrack | remove from Liked Songs | trackId ← likeTrack | success | write, reverse of likeTrack |
| addToPlaylist | add tracks to playlist | playlistId, trackUris ← searchMusic | snapshot_id | write, requires ownership |
| removeFromPlaylist | remove tracks from playlist | playlistId, trackUris ← addToPlaylist | snapshot_id | write, reverse of addToPlaylist |
| createPlaylist | create new playlist | name, description, public | uri, name, owner | write, requires login |

## Quick Start

```bash
# Search for an artist
openweb spotify exec searchMusic '{"searchTerm":"radiohead","limit":5}'

# Get artist details (uri from search results)
openweb spotify exec getArtist '{"uri":"spotify:artist:4Z8W4fKeB5YxbusRsdQVPb"}'

# Get discography
openweb spotify exec getArtistDiscography '{"uri":"spotify:artist:4Z8W4fKeB5YxbusRsdQVPb","limit":10}'

# Get album tracks (uri from artist or discography)
openweb spotify exec getAlbumTracks '{"uri":"spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE"}'

# Get track details
openweb spotify exec getTrack '{"uri":"spotify:track:4u7EnebtmKWzUH433cf5Qv"}'

# Get playlist details and tracks
openweb spotify exec getPlaylist '{"uri":"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M","limit":10}'

# Get a user's public playlists
openweb spotify exec getUserPlaylists '{"userId":"spotify","limit":5}'

# Get recommendations based on a track
openweb spotify exec getRecommendations '{"uri":"spotify:track:4u7EnebtmKWzUH433cf5Qv","limit":5}'

# Like a track (requires login)
openweb spotify exec likeTrack '{"trackId":"4u7EnebtmKWzUH433cf5Qv"}'

# Unlike a track (requires login)
openweb spotify exec unlikeTrack '{"trackId":"4u7EnebtmKWzUH433cf5Qv"}'

# Create a playlist (requires login)
openweb spotify exec createPlaylist '{"name":"My Playlist","description":"A new playlist","public":false}'

# Add tracks to a playlist (requires login, playlist ownership)
openweb spotify exec addToPlaylist '{"playlistId":"37i9dQZF1DXcBWIGoYBM5M","trackUris":["spotify:track:4u7EnebtmKWzUH433cf5Qv"]}'

# Remove tracks from a playlist (requires login, playlist ownership)
openweb spotify exec removeFromPlaylist '{"playlistId":"37i9dQZF1DXcBWIGoYBM5M","trackUris":["spotify:track:4u7EnebtmKWzUH433cf5Qv"]}'
```

---

## Site Internals

### API Architecture
- GraphQL API via `api-partner.spotify.com/pathfinder/v2/query`
- Persisted queries with `sha256Hash` — no inline query strings
- Single endpoint, operations differentiated by `operationName` + hash
- Cross-origin: API on `api-partner.spotify.com`, web app on `open.spotify.com`
- REST API via `spclient.wg.spotify.com` for user profile / playlists

### Auth
- Bearer token extracted from web player's fetch interceptor at runtime
- `client-token` also required (obtained from `clienttoken.spotify.com`)
- Both tokens are managed by the adapter via request interception
- Works for both anonymous and logged-in users
- Write operations (like, playlist management) require a logged-in session with appropriate scopes

### Transport
- Adapter (`spotify-pathfinder`) — required because:
  1. Cross-origin API (different domain than web app)
  2. Bearer token must be extracted from web player runtime
  3. GraphQL persisted queries need specific request formatting
  4. getUserPlaylists uses a separate REST API (spclient.wg.spotify.com)
  5. Write ops (like/unlike, playlist CRUD) use Spotify Web API (api.spotify.com/v1)

### Adapter Patterns
- **Shape:** `CustomRunner` with `run(ctx)` entry (migrated from legacy `CodeAdapter` in Phase 5C). No `init()` / `isAuthenticated()` — Spotify works anonymously, and URL-match probes are redundant with PagePlan.
- **Dispatch:** Two parallel handler tables keyed by `operation`:
  - `GRAPHQL_OPERATIONS` — pathfinder persisted-query ops (search, getArtist, getTrack, etc.)
  - `WRITE_OPERATIONS` — Web API mutations (likeTrack, createPlaylist, addToPlaylist, …) plus the REST `getUserPlaylists`
  `run()` looks up the handler and invokes it; no imperative switch.
- **Token cascade:** Bearer + client-token cached at module scope, refreshed on demand. `isNeedsLogin(err)` helper centralizes the 401/403 retry decision shared by every handler.

### Extraction
- Direct JSON responses from GraphQL API
- User profile REST endpoint returns JSON with `Accept: application/json` header

### Known Issues
- **Token expiry:** Bearer tokens expire periodically; adapter retries with fresh token on 401/403
- **Rate limiting:** `api.spotify.com/v1/` rate-limits aggressively with web player tokens; use pathfinder API instead
- **Persisted query hashes:** Hashes may change with web player updates; re-capture if queries return `PersistedQueryNotFound`
- **Anonymous access:** Search works without login, but results may be limited
- **getUserPlaylists:** Uses REST endpoint on `spclient.wg.spotify.com`, not GraphQL pathfinder
