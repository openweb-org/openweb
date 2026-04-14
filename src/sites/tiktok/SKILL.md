# TikTok

## Overview
Short-video social platform. Content platform archetype.

## Workflows

### Search videos
1. `searchVideos(keyword)` → `id`, `desc`, `author.uniqueId`, stats
2. Paginate: use `cursor` from response as `offset` in next call while `has_more` = 1

### Search and explore a user
1. `searchUsers(keyword)` → `user_info.uid`, `unique_id`, `nickname`, `follower_count`
2. `getUserProfile(username)` → full profile → `id` (numeric userId)
3. `getUserVideos(username)` → paginated uploads → `id` (videoId), stats

### Get video detail and comments
1. `getVideoDetail(username, videoId)` → full metadata, stats, `author.uniqueId`
2. `getVideoComments(username, videoId)` → comments → `cid` (commentId), author, likes, `reply_count`
3. `getCommentReplies(item_id=videoId, comment_id=cid)` → threaded replies

### Discover trending content
1. `getHomeFeed()` → recommended/trending videos → `id`, `author.uniqueId`
2. `getExplore()` → trending videos from Explore page → `id`, `author.uniqueId`

### Explore hashtags
1. `getHashtagDetail(challengeName)` → `challenge.id`, `stats.videoCount`, `stats.viewCount`
2. `getHashtagVideos(hashtag)` → videos using the hashtag → `id`, stats

### Related videos
1. `getVideoDetail(username, videoId)` → confirm video exists
2. `getRelatedVideos(username, videoId)` → recommended next videos → `id`

### Like / unlike a video
1. `searchVideos(keyword)` or `getHomeFeed()` → pick video → `id`
2. `likeVideo(videoId=id)` → like the video
3. `unlikeVideo(videoId=id)` → reverse the like

### Follow / unfollow a user
1. `getUserProfile(username)` → `id` (numeric userId)
2. `followUser(userId=id)` → follow the user
3. `unfollowUser(userId=id)` → reverse the follow

### Block / unblock a user
1. `getUserProfile(username)` → `id` (numeric userId)
2. `blockUser(userId=id)` → block the user
3. `unblockUser(userId=id)` → reverse the block

### Bookmark / unbookmark a video
1. `searchVideos(keyword)` or `getVideoDetail(username, videoId)` → `id`
2. `bookmarkVideo(videoId=id)` → add video to favorites
3. `unbookmarkVideo(videoId=id)` → remove from favorites

### Comment on a video
1. `getVideoDetail(username, videoId)` → confirm video → `id`
2. `createComment(videoId=id, text)` → post a comment → `commentId`
3. `deleteComment(videoId=id, commentId)` → delete own comment

### Reply to a comment
1. `getVideoComments(username, videoId)` → find comment → `cid` (commentId)
2. `replyComment(videoId, commentId=cid, text)` → post reply → `commentId`

### Like / unlike a comment
1. `getVideoComments(username, videoId)` → find comment → `cid` (commentId)
2. `likeComment(videoId, commentId=cid)` → like the comment
3. `unlikeComment(videoId, commentId=cid)` → reverse the like

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search videos by keyword | keyword | id, desc, author.uniqueId, stats | paginated via offset/cursor |
| searchUsers | search users by keyword | keyword | user_info.uid, unique_id, nickname, follower_count | paginated via cursor |
| getVideoDetail | get video details | username, videoId | description, stats, music, author, challenges | SSR extraction from video page |
| getUserProfile | get user profile | username | id, followers, following, bio, video count, verified | SSR extraction, `id` needed for follow/block |
| getUserVideos | get user's uploads | username | id (videoId), description, stats | adapter op, paginated |
| getVideoComments | get comments on a video | username, videoId | cid, text, author, digg_count, reply_count | API interception from video page |
| getCommentReplies | get replies to a comment | item_id <- getVideoComments, comment_id <- getVideoComments.cid | cid, text, author, digg_count | paginated via cursor |
| getHomeFeed | get trending/recommended | — | id, desc, author, stats | API interception from For You feed |
| getExplore | get explore/discover videos | — | id, desc, author, stats | API interception from Explore page |
| getHashtagDetail | get hashtag info | challengeName | challenge.id, stats.videoCount, stats.viewCount | |
| getHashtagVideos | get videos for hashtag | hashtag | id, description, stats | adapter op |
| getRelatedVideos | get related videos | username, videoId <- getVideoDetail | id, description | adapter op |
| likeVideo | like a video | videoId <- searchVideos/getHomeFeed | success, is_digg | write, caution |
| unlikeVideo | unlike a video | videoId <- likeVideo source | success, is_digg | write, reverse of likeVideo |
| followUser | follow a user | userId <- getUserProfile.id | success, follow_status | write, caution |
| unfollowUser | unfollow a user | userId <- getUserProfile.id | success, follow_status | write, reverse of followUser |
| blockUser | block a user | userId <- getUserProfile.id | success | write, caution |
| unblockUser | unblock a user | userId <- getUserProfile.id | success | write, reverse of blockUser |
| bookmarkVideo | bookmark a video | videoId <- searchVideos/getVideoDetail | success | write, caution |
| unbookmarkVideo | unbookmark a video | videoId <- bookmarkVideo source | success | write, reverse of bookmarkVideo |
| createComment | post a comment | videoId <- getVideoDetail, text | success, commentId | write, caution |
| deleteComment | delete a comment | videoId, commentId <- createComment | success | write, must be comment author |
| replyComment | reply to a comment | videoId, commentId <- getVideoComments.cid, text | success, commentId | write, caution |
| likeComment | like a comment | videoId, commentId <- getVideoComments.cid | success, is_digg | write, caution |
| unlikeComment | unlike a comment | videoId, commentId <- getVideoComments.cid | success, is_digg | write, reverse of likeComment |

## Quick Start

```bash
# Search for cooking videos
openweb tiktok exec searchVideos '{"keyword":"cooking"}'

# Paginate (use cursor from previous response as offset)
openweb tiktok exec searchVideos '{"keyword":"cooking","offset":12,"count":5}'

# Search for users
openweb tiktok exec searchUsers '{"keyword":"charlidamelio"}'

# Get video details
openweb tiktok exec getVideoDetail '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get user profile
openweb tiktok exec getUserProfile '{"username":"charlidamelio"}'

# Get a user's uploaded videos
openweb tiktok exec getUserVideos '{"username":"tiktok"}'

# Get video comments
openweb tiktok exec getVideoComments '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get replies to a comment
openweb tiktok exec getCommentReplies '{"item_id":"7626810027520593183","comment_id":"7626813820006859527"}'

# Get trending/recommended videos
openweb tiktok exec getHomeFeed '{}'

# Get explore page videos
openweb tiktok exec getExplore '{}'

# Get hashtag detail
openweb tiktok exec getHashtagDetail '{"challengeName":"cooking"}'

# Get videos for a hashtag
openweb tiktok exec getHashtagVideos '{"hashtag":"cooking"}'

# Get related videos
openweb tiktok exec getRelatedVideos '{"username":"tiktok","videoId":"7626810027520593183"}'

# Like a video (videoId from search/feed)
openweb tiktok exec likeVideo '{"videoId":"7626810027520593183"}'

# Unlike a video
openweb tiktok exec unlikeVideo '{"videoId":"7626810027520593183"}'

# Follow a user (numeric userId from getUserProfile)
openweb tiktok exec followUser '{"userId":"107955"}'

# Unfollow a user
openweb tiktok exec unfollowUser '{"userId":"107955"}'

# Block a user (numeric userId from getUserProfile)
openweb tiktok exec blockUser '{"userId":"107955"}'

# Unblock a user
openweb tiktok exec unblockUser '{"userId":"107955"}'

# Bookmark a video
openweb tiktok exec bookmarkVideo '{"videoId":"7626810027520593183"}'

# Unbookmark a video
openweb tiktok exec unbookmarkVideo '{"videoId":"7626810027520593183"}'

# Post a comment
openweb tiktok exec createComment '{"videoId":"7626810027520593183","text":"Great video!"}'

# Delete a comment
openweb tiktok exec deleteComment '{"videoId":"7626810027520593183","commentId":"7345678901234567891"}'

# Reply to a comment (commentId from getVideoComments)
openweb tiktok exec replyComment '{"videoId":"7626810027520593183","commentId":"7626813820006859527","text":"Great point!"}'

# Like a comment (commentId from getVideoComments)
openweb tiktok exec likeComment '{"videoId":"7626810027520593183","commentId":"7626813820006859527"}'

# Unlike a comment
openweb tiktok exec unlikeComment '{"videoId":"7626810027520593183","commentId":"7626813820006859527"}'
```
