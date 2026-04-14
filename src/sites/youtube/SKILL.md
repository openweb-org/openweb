# YouTube

## Overview
Video content platform. InnerTube JSON API on `www.youtube.com`.

## Workflows

### Search and watch a video
1. `searchVideos(query)` → video titles, thumbnails, `videoId`s
2. `getVideoDetail(videoId)` → title, description, recommendations
3. `getComments(videoId)` → comment threads with author, text, likes, replies
4. `getVideoPlayer(videoId)` → stream URLs, formats, captions

### Browse a channel or playlist
1. `browseContent(browseId: "FEwhat_to_watch")` → homepage video grid with `videoId`s
2. `browseContent(browseId: "UC...")` → channel page with tabs, videos
3. `getPlaylist(playlistId)` → playlist title, owner, full video list

### Get a video transcript
1. `getVideoDetail(videoId)` → find `engagementPanels[].engagementPanelSectionListRenderer` with `panelIdentifier: "engagement-panel-searchable-transcript"` → extract `params` token
2. `getTranscript(params)` → timestamped transcript lines

### Subscribe / unsubscribe a channel
1. `searchVideos(query)` or `browseContent(browseId)` → `channelId` (`UC...`)
2. `subscribeChannel(channelIds: [channelId])` → confirmation
3. `unsubscribeChannel(channelIds: [channelId])` → reverses subscription

### Comment on a video
1. `searchVideos(query)` → `videoId`
2. `addComment(videoId, text)` → `commentId`
3. `deleteComment(videoId, commentId)` → removes the comment

> **Note:** `getTranscript` requires a `params` token from `getVideoDetail`, not a direct videoId. The params token is session-bound; the endpoint may return FAILED_PRECONDITION without valid session context.

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search by keyword | query | videoId, title, channelName, viewCount, duration, thumbnail | entry point |
| browseContent | browse feeds/channels | browseId (FEwhat_to_watch, FEtrending, UC..., VL...) | video grids, channel tabs, metadata | see browseId patterns below |
| getVideoDetail | video metadata + recommendations | videoId ← searchVideos | title, description, viewCount, likes, publishDate, recommendations | |
| getComments | video comments | videoId ← searchVideos | commentId, author, text, likeCount, replyCount, publishedTime | adapter — two-step continuation |
| getPlaylist | playlist details + videos | playlistId ← searchVideos/browseContent | title, owner, videoCount, videos with videoId, duration | adapter — wraps /browse with VL prefix |
| getVideoPlayer | player + stream info | videoId ← searchVideos | streamingData, formats, captions, playabilityStatus | stream URLs restricted without auth |
| getGuide | sidebar navigation | — | subscriptions, explore categories, library links | |
| getTranscript | video transcript | params ← getVideoDetail engagement panel | timestamped transcript lines | not in openapi.yaml — see Known Issues |
| getNotificationCount | unseen notifications | — | unseenCount | requires sapisidhash auth |
| likeVideo | like a video | videoId ← searchVideos | confirmation | requires sapisidhash auth, SAFE (reversible) |
| unlikeVideo | remove like | videoId ← searchVideos | confirmation | requires sapisidhash auth |
| subscribeChannel | subscribe to channel | channelIds | confirmation | requires sapisidhash auth, SAFE (reversible) |
| unsubscribeChannel | unsubscribe from channel | channelIds | confirmation | requires sapisidhash auth, reverses subscribeChannel |
| addComment | post comment on video | videoId, text | commentId, text, author | adapter — requires sapisidhash auth, reversible via deleteComment |
| deleteComment | delete own comment | videoId, commentId ← addComment/getComments | confirmation (deleted: true) | adapter — requires sapisidhash auth, reverses addComment |

### browseId Patterns
- **Home feed:** `FEwhat_to_watch`
- **Trending:** `FEtrending`
- **Subscriptions:** `FEsubscriptions`
- **Channel:** `UC...` (e.g. `UCsBjURrPoezykLs9EqgamOA`)
- **Playlist:** `VL` + playlist ID (e.g. `VLPLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt`)

## Quick Start

```bash
# Search videos
openweb youtube exec searchVideos '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "query": "machine learning tutorial"}'

# Get video detail (title, description, comments, recommendations)
openweb youtube exec getVideoDetail '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Get video player info (stream URLs, formats, captions)
openweb youtube exec getVideoPlayer '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Browse homepage
openweb youtube exec browseContent '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "browseId": "FEwhat_to_watch"}'

# Get comments on a video (adapter — only needs videoId)
openweb youtube exec getComments '{"videoId": "dQw4w9WgXcQ"}'

# Get playlist details and videos (adapter — only needs playlistId)
openweb youtube exec getPlaylist '{"playlistId": "PLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt"}'

# Unsubscribe from a channel (requires auth)
openweb youtube exec unsubscribeChannel '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "channelIds": ["UCsBjURrPoezykLs9EqgamOA"]}'

# Add a comment to a video (adapter — requires auth)
openweb youtube exec addComment '{"videoId": "dQw4w9WgXcQ", "text": "Great video!"}'

# Delete own comment (adapter — requires auth)
openweb youtube exec deleteComment '{"videoId": "dQw4w9WgXcQ", "commentId": "UgzB1_kM5yz1Nv0nHdR4AaABAg"}'
```
