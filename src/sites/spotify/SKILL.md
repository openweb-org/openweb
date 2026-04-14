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
1. `searchMusic(searchTerm)` → pick track → `uri` (e.g. `spotify:track:<trackId>`) → extract `trackId`
2. `likeTrack(trackId)` → save track to Liked Songs
3. `unlikeTrack(trackId)` → remove from Liked Songs

### Playlist curation (requires login)
1. `createPlaylist(name, description, public)` → `uri`, extract `playlistId`
2. `searchMusic(searchTerm)` → pick tracks → `trackUris`
3. `addToPlaylist(playlistId ← createPlaylist, trackUris ← searchMusic)` → `snapshot_id`
4. `removeFromPlaylist(playlistId, trackUris)` → `snapshot_id`

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
