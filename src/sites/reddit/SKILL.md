# Reddit

## Overview
Social media platform — link aggregation, discussion, communities (subreddits). Social Media archetype.

## Workflows

### Browse and read a subreddit
1. `getSubredditPosts(subreddit)` → pick post → `post_id`, `subreddit`
2. `getPostComments(subreddit, post_id)` → post detail + comment tree

### Search and dive into a post
1. `searchPosts(q)` → results with `subreddit`, post `id`
2. `getPostComments(subreddit, post_id)` → full post + comments

### Investigate a user
1. `getUserProfile(username)` → karma, account age, verified status
2. `getUserPosts(username)` → recent posts and comments

### Create a post in a subreddit
1. `getSubredditAbout(subreddit)` → confirm subreddit exists → `subreddit` name
2. `createPost(sr=subreddit, title, kind, text)` → post `fullname` (t3_xxx), `url`

### Reply to a post
1. `getSubredditPosts(subreddit)` → pick post → `name` (fullname, e.g. t3_xxx)
2. `createComment(thing_id=name, text)` → comment `id`, `body`

### Reply to a comment
1. `getPostComments(subreddit, post_id)` → pick comment → `name` (fullname, e.g. t1_xxx)
2. `createComment(thing_id=name, text)` → comment `id`, `body`

### Vote on a post
1. `getSubredditPosts(subreddit)` → pick post → `name` (fullname)
2. `vote(id=name, dir)` → dir: 1=upvote, 0=unvote, -1=downvote

### Save a post
1. `getSubredditPosts(subreddit)` → pick post → `name` (fullname)
2. `savePost(id=name)` → saved

### Unsave a post
1. `savePost` result or `getSubredditPosts` → `name` (fullname)
2. `unsavePost(id=name)` → unsaved

### Delete own post
1. `createPost(...)` → `fullname` (t3_xxx)
2. `deleteThing(id=fullname)` → deleted

### Delete own comment
1. `createComment(...)` → comment `name` (t1_xxx)
2. `deleteThing(id=name)` → deleted

### Subscribe to a subreddit
1. `getSubredditAbout(subreddit)` → `subreddit` name
2. `subscribe(action="sub", sr_name=subreddit)` → subscribed

### Unsubscribe from a subreddit
1. `subscribe(action="unsub", sr_name=subreddit)` → unsubscribed

### Block a user
1. `getUserProfile(username)` → `account_id` (t2_xxx)
2. `blockUser(account_id=account_id)` → blocked

### Check notifications
1. `getNotifications(limit)` → inbox: replies, mentions, messages

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getSubredditPosts | get subreddit feed | subreddit | title, author, score, url, after | entry point; paginated |
| getPopularPosts | get trending posts | — | title, subreddit, score, url, after | entry point |
| searchPosts | search posts by keyword | q | title, subreddit, score, url | entry point; sort, time, type filters |
| getPostComments | get post + comment tree | subreddit, post_id ← getSubredditPosts | title, selftext, comment tree | returns [post, comments] array |
| getUserProfile | get user profile | username | karma, created, verified, is_gold | entry point |
| getUserPosts | get user activity | username | title, body, subreddit, score | entry point; sort: new/hot/top |
| getSubredditAbout | get subreddit metadata | subreddit | subscribers, description, active_users | entry point |
| vote | vote on post/comment | id ← getSubredditPosts | — | write; requires auth |
| savePost | bookmark post/comment | id ← getSubredditPosts | — | write; requires auth |
| getMe | authenticated user profile | — | name, karma, verified | requires auth; oauth.reddit.com |
| createPost | create self/link post | sr, title, kind, text | post fullname, url | write; caution; oauth.reddit.com |
| createComment | reply to post/comment | thing_id ← getSubredditPosts, text | comment id, body | write; caution; oauth.reddit.com |
| deleteThing | delete post or comment | id ← createPost / createComment | — | write; caution; oauth.reddit.com |
| subscribe | sub/unsub subreddit | action, sr_name | — | write; caution; oauth.reddit.com |
| unsavePost | remove from saved | id ← savePost | — | write; caution; oauth.reddit.com |
| blockUser | block a user | account_id ← getUserProfile | — | write; caution; oauth.reddit.com |
| getNotifications | get inbox notifications | — | author, body, subject, type, new | requires auth; oauth.reddit.com |

## Quick Start

```bash
# Get subreddit posts
openweb reddit exec getSubredditPosts '{"subreddit": "programming"}'

# Search posts
openweb reddit exec searchPosts '{"q": "typescript"}'

# Get popular posts
openweb reddit exec getPopularPosts '{}'

# Get post with comments (post_id from a listing)
openweb reddit exec getPostComments '{"subreddit": "programming", "post_id": "1s5ja3a"}'

# Get user profile
openweb reddit exec getUserProfile '{"username": "spez"}'

# Get user's recent posts/comments
openweb reddit exec getUserPosts '{"username": "spez"}'

# Get subreddit metadata
openweb reddit exec getSubredditAbout '{"subreddit": "programming"}'

# Create a self post (requires auth)
openweb reddit exec createPost '{"sr": "test", "title": "Hello", "kind": "self", "text": "Body text"}'

# Comment on a post (requires auth)
openweb reddit exec createComment '{"thing_id": "t3_abc123", "text": "Great post!"}'

# Delete a post or comment (requires auth)
openweb reddit exec deleteThing '{"id": "t3_abc123"}'

# Subscribe to a subreddit (requires auth)
openweb reddit exec subscribe '{"action": "sub", "sr_name": "programming"}'

# Unsubscribe from a subreddit (requires auth)
openweb reddit exec subscribe '{"action": "unsub", "sr_name": "programming"}'

# Unsave a post (requires auth)
openweb reddit exec unsavePost '{"id": "t3_abc123"}'

# Block a user (requires auth)
openweb reddit exec blockUser '{"account_id": "t2_abc123"}'

# Get inbox notifications (requires auth)
openweb reddit exec getNotifications '{"limit": 25}'
```
