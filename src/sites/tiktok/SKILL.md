# TikTok

## Overview
Short-video social platform. Content platform archetype.

## Workflows

### Search videos
1. `searchVideos(keyword)` → video results with id, description, author, stats
2. Paginate: use `cursor` from response as `offset` in next call while `has_more` = 1

### Get video detail
1. `getVideoDetail(username, videoId)` → full video metadata, stats, music, author

### Get user profile
1. `getUserProfile(username)` → follower/following counts, bio, video count, verified status

### Browse video and read comments
1. `getVideoDetail(username, videoId)` → video metadata
2. `getVideoComments(username, videoId)` → comments with author, likes, reply count

### Discover trending content
1. `getHomeFeed()` → recommended/trending videos from the For You page
2. `getExplore()` → trending videos from the Explore/Discover page

### Like / unlike a video
1. `likeVideo(videoId)` → like a video
2. `unlikeVideo(videoId)` → reverse the like

### Follow / unfollow a user
1. `getUserProfile(username)` → get the numeric `id`
2. `followUser(userId)` → follow the user
3. `unfollowUser(userId)` → reverse the follow

### Bookmark / unbookmark a video
1. `bookmarkVideo(videoId)` → add video to favorites
2. `unbookmarkVideo(videoId)` → remove from favorites

### Comment on a video
1. `createComment(videoId, text)` → post a comment, returns `commentId`
2. `deleteComment(videoId, commentId)` → delete own comment

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search videos by keyword | keyword | id, desc, author, stats, video URLs | paginated via offset/cursor |
| getVideoDetail | get video details | username, videoId | description, stats, music, author, challenges | SSR extraction from video page |
| getUserProfile | get user profile | username | followers, following, bio, video count, verified | SSR extraction from profile page |
| getVideoComments | get comments on a video | username, videoId | comment text, author, likes, reply count | API interception from video page |
| getHomeFeed | get trending/recommended videos | — | video details, stats, authors | API interception from For You feed |
| getExplore | get explore/discover videos | — | video details, stats, authors | API interception from Explore page |
| likeVideo | like a video | videoId | success, is_digg | write, caution — may be bot-blocked |
| unlikeVideo | unlike a video | videoId | success, is_digg | write, caution — reverse of likeVideo |
| followUser | follow a user | userId | success, follow_status | write, caution — may be bot-blocked |
| unfollowUser | unfollow a user | userId | success, follow_status | write, caution — reverse of followUser |
| bookmarkVideo | bookmark a video | videoId | success | write, caution — may be bot-blocked |
| unbookmarkVideo | unbookmark a video | videoId | success | write, caution — reverse of bookmarkVideo |
| createComment | post a comment | videoId, text | success, commentId | write, caution — may be bot-blocked |
| deleteComment | delete a comment | videoId, commentId | success | write, caution — must be comment author |

## Quick Start

```bash
# Search for cooking videos
openweb tiktok exec searchVideos '{"keyword":"cooking"}'

# Paginate (use cursor from previous response as offset)
openweb tiktok exec searchVideos '{"keyword":"cooking","offset":12,"count":5}'

# Get video details
openweb tiktok exec getVideoDetail '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get user profile
openweb tiktok exec getUserProfile '{"username":"charlidamelio"}'

# Get video comments
openweb tiktok exec getVideoComments '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get trending/recommended videos
openweb tiktok exec getHomeFeed '{}'

# Get explore page videos
openweb tiktok exec getExplore '{}'

# Like a video
openweb tiktok exec likeVideo '{"videoId":"7626810027520593183"}'

# Unlike a video
openweb tiktok exec unlikeVideo '{"videoId":"7626810027520593183"}'

# Follow a user (need numeric userId from getUserProfile)
openweb tiktok exec followUser '{"userId":"107955"}'

# Unfollow a user
openweb tiktok exec unfollowUser '{"userId":"107955"}'

# Bookmark a video
openweb tiktok exec bookmarkVideo '{"videoId":"7626810027520593183"}'

# Unbookmark a video
openweb tiktok exec unbookmarkVideo '{"videoId":"7626810027520593183"}'

# Post a comment
openweb tiktok exec createComment '{"videoId":"7626810027520593183","text":"Great video!"}'

# Delete a comment
openweb tiktok exec deleteComment '{"videoId":"7626810027520593183","commentId":"7345678901234567891"}'
```
