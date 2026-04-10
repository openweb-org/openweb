# Spotify — Site Summary

## Coverage
- **Total operations:** 13 (8 read, 5 write)
- **Transport:** adapter (L3) — headed browser on port 9222
- **Auth:** cookie_session (bearer token extracted from web player runtime)
- **Verify:** 8/8 read ops PASS, 5 write ops skipped (unsafe_mutation)

## Read Operations (8)
| Operation | Description |
|-----------|-------------|
| searchMusic | Search across artists, tracks, albums, playlists |
| getArtist | Artist profile, stats, top tracks, related artists |
| getArtistDiscography | Full discography with release dates |
| getAlbumTracks | Track listing for an album |
| getTrack | Track details — play count, duration, content rating |
| getPlaylist | Playlist details and track list |
| getUserPlaylists | User's public playlists |
| getRecommendations | Similar tracks from a seed track |

## Write Operations (5)
| Operation | Description | Permission | Safety |
|-----------|-------------|------------|--------|
| likeTrack | Save track to Liked Songs | write | caution |
| unlikeTrack | Remove track from Liked Songs | write | caution |
| addToPlaylist | Add tracks to a playlist | write | caution |
| removeFromPlaylist | Remove tracks from a playlist | write | caution |
| createPlaylist | Create a new playlist | write | caution |

## API Architecture
- **Read ops:** GraphQL via `api-partner.spotify.com/pathfinder/v2/query` (persisted queries with sha256Hash)
- **getUserPlaylists:** REST via `spclient.wg.spotify.com/user-profile-view/v3/`
- **Write ops:** REST via `api.spotify.com/v1/` (standard Spotify Web API)
- Bearer + client-token extracted from web player request interception
- Write ops require logged-in session

## Write/Reverse Pairs
- `likeTrack` ↔ `unlikeTrack`
- `addToPlaylist` ↔ `removeFromPlaylist`
- `createPlaylist` (no reverse — deletion not implemented)
