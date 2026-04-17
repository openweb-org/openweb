# Hacker News

## Overview
Tech news aggregator by Y Combinator. Reads via Algolia Search API and Firebase API (node-direct). Writes via browser page context.

## Workflows

### Browse and read a story
1. `getTopStories` → pick story → note `objectID`
2. `getStoryDetail(id)` → title, url, points, author, nested comment tree

### Upvote a story
1. Get the item ID (from `getStoryDetail` or feed `objectID`)
2. `upvoteStory(id)` → upvotes the story (requires logged-in cookie session)

### Comment on a story
1. Get the item ID (story or comment to reply to)
2. `addComment(parent, text)` → posts a comment (requires logged-in cookie session)

### Explore a user
1. `getUserProfile(id)` → karma, created, about
2. `getUserSubmissions(id)` → stories they posted
3. `getUserComments(id)` → their comment history

### Find stories from a domain
1. `getStoriesByDomain(query)` → all stories linking to that domain

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
| getStoryComments | comment thread | id, limit? | storyId, commentCount, comments[] | adapter node (Algolia) |
| getStoriesByDomain | domain stories | query (domain) | objectID, title, url, author, points | L1 node (Algolia) |
| getUserSubmissions | user's stories | id (username) | objectID, title, url, author, points | adapter node (Algolia) |
| getUserComments | user's comments | id (username) | objectID, author, comment_text | adapter node (Algolia) |
| upvoteStory | upvote item | id | ok, id | adapter (page) |
| addComment | post comment | parent, text | ok, parent | adapter (page) |

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
openweb hackernews exec getStoriesByDomain '{"query": "github.com"}'

# Latest comments site-wide
openweb hackernews exec getNewComments '{}'

# Upvote a story (requires browser + login)
openweb hackernews exec upvoteStory '{"id": 42407357}'

# Comment on a story (requires browser + login)
openweb hackernews exec addComment '{"parent": 42407357, "text": "Great article!"}'
```

---

## Site Internals

## API Architecture
- **Reads**: Two public APIs, no auth required:
  - **Algolia** (`hn.algolia.com/api/v1/`): search, feeds, story detail with nested comments
  - **Firebase** (`hacker-news.firebaseio.com/v0/`): item detail, user profiles
- **Writes**: Form-based submission to `news.ycombinator.com` — no public write API

## Auth
No auth for reads. Write operations (`upvoteStory`, `addComment`) require a logged-in cookie session in the browser. Vote link href contains auth token; comment form contains HMAC token.

## Transport
- **14 node ops total**: All read ops use node transport — no browser needed
  - 10 L1 declarative node ops: Direct HTTP to Algolia/Firebase
  - 4 adapter node ops: Node.js `fetch` to Algolia via adapter (parameterized queries that need value composition)
- **2 adapter write ops**: `page.evaluate(fetch(...))` with DOM extraction for auth tokens

## Known Issues
- Algolia data has ~30s delay from HN (near-real-time, not instant)
- Firebase `user.submitted` returns all IDs (can be thousands) — Algolia is more efficient for user activity
- No bot detection from any API
- Write ops still need DOM for auth token extraction (no alternative)
