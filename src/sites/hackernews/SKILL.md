# Hacker News

## Overview
Tech news aggregator by Y Combinator. Reads via Algolia Search API and Firebase API (node-direct). Writes via browser page context.

## Workflows

### Browse and read a story
1. `getTopStories` → pick story → note `objectID`
2. `getStoryDetail(id)` → title, url, points, author, nested comment tree

### Upvote a story
1. `getTopStories` → pick story → `objectID`
2. `upvoteStory(id=objectID)` → upvotes the story (requires login)

### Comment on a story
1. `getStoryDetail(id)` → `item.id`
2. `addComment(parent=item.id, text)` → posts top-level comment (requires login)

### Reply to a comment
1. `getStoryDetail(id)` → `children[]` → pick comment → `comment.id`
2. `addComment(parent=comment.id, text)` → posts reply (requires login)

### Explore a user
1. `getUserProfile(id)` → karma, created, about
2. `getUserSubmissions(id)` → stories they posted
3. `getUserComments(id)` → their comment history

### Find stories from a domain
1. `getStoriesByDomain(site)` → all stories linking to that domain

### Read latest activity
1. `getNewComments` → newest comments across all stories

## Operations

| Operation | Intent | Key Input | Key Output | Transport |
|-----------|--------|-----------|------------|-----------|
| getTopStories | browse top stories | — | objectID, title, url, author, points, num_comments | L1 node (Algolia) |
| getNewestStories | browse newest | — | same as above | L1 node (Algolia) |
| getBestStories | browse highest-voted | — | same as above | L1 node (Algolia) |
| getAskStories | browse Ask HN | — | same as above | L1 node (Algolia) |
| getShowStories | browse Show HN | — | same as above | L1 node (Algolia) |
| getJobPostings | browse jobs | — | objectID, title, url, created_at | L1 node (Algolia) |
| getFrontPageStories | time-based front page | — | same as feeds | L1 node (Algolia) |
| getStoryDetail | story + comment tree | id (item ID) | id, title, url, points, children[] | L1 node (Algolia) |
| getUserProfile | user profile | id (username) | id, karma, created, about | L1 node (Firebase) |
| getNewComments | newest comments | — | objectID, author, comment_text, story_title | L1 node (Algolia) |
| getStoryComments | comment thread | id, limit? | storyId, commentCount, comments[] | adapter (Algolia) |
| getStoriesByDomain | domain stories | site | objectID, title, url, author, points | adapter (Algolia) |
| getUserSubmissions | user's stories | id (username) | objectID, title, url, author, points | adapter (Algolia) |
| getUserComments | user's comments | id (username) | objectID, author, comment_text | adapter (Algolia) |
| upvoteStory | upvote item | id <- feeds/getStoryDetail | ok, id | adapter (page) |
| addComment | post comment | parent <- getStoryDetail, text | ok, parent | adapter (page) |

## Quick Start

```bash
# Browse top stories (node-direct, no browser needed)
openweb hackernews exec getTopStories '{}'

# Get story detail with full comment tree
openweb hackernews exec getStoryDetail '{"id": 42407357}'

# Get comments for a story (with limit)
openweb hackernews exec getStoryComments '{"id": 42407357, "limit": 10}'

# Look up a user (Firebase API)
openweb hackernews exec getUserProfile '{"id": "pg"}'

# User's submitted stories
openweb hackernews exec getUserSubmissions '{"id": "pg"}'

# Stories from a domain
openweb hackernews exec getStoriesByDomain '{"site": "github.com"}'

# Latest comments site-wide
openweb hackernews exec getNewComments '{}'

# Upvote a story (requires browser + login)
openweb hackernews exec upvoteStory '{"id": 42407357}'

# Comment on a story (requires browser + login)
openweb hackernews exec addComment '{"parent": 42407357, "text": "Great article!"}'
```
