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
