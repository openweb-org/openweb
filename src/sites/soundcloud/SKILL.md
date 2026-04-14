# SoundCloud

## Overview
Music streaming platform popular with independent artists. Public REST API at api-v2.soundcloud.com for searching tracks, viewing artist profiles, and browsing playlists.

## Workflows

### Find and explore a track
1. `searchTracks(q)` → browse `collection[]` → pick `id`, note `user.id`
2. `getTrack(id)` → title, duration, playback_count, waveform_url, `user.id`
3. `getUser(id=user.id)` → artist profile, followers_count, track_count

### Explore an artist
1. `searchTracks(q)` → find tracks by artist → `collection[].user.id`
2. `getUser(id=user.id)` → username, bio, followers_count, track_count

### Browse a playlist
1. `getPlaylist(id)` → title, description, `tracks[].id`
2. `getTrack(id=tracks[].id)` → full detail on individual tracks

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTracks | find tracks by keyword | q | id, title, user.id, playback_count, duration | entry point, paginated via offset/limit |
| getTrack | full track details | id <- searchTracks | title, duration, plays, likes, waveform_url, user.id | includes user object |
| getUser | artist/user profile | id <- getTrack.user.id | username, bio, followers_count, track_count, verified | |
| getPlaylist | playlist with tracks | id | title, track_count, duration, tracks[].id | tracks array embedded |

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
