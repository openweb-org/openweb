# Hacker News

## Overview
Tech news aggregator by Y Combinator. Pure server-rendered HTML — all data extracted from DOM.

## Workflows

### Browse and read a story
1. `getTopStories` (or any feed op) → pick story → note title
2. Feed stories don't carry item IDs — search by title or use HN search to get the ID
3. `getStoryDetail(id)` → title, url, score, author, comments

### Explore a user
1. `getUserProfile(id)` → karma, created, about
2. `getUserSubmissions(id)` → stories they posted
3. `getUserComments(id)` → their comment history

### Find stories from a domain
1. `getStoriesByDomain(site)` → all stories linking to that domain

### Read latest activity
1. `getNewComments` → newest comments across all stories

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getTopStories | browse top stories | — | title, score, author, age | entry point |
| getNewestStories | browse newest stories | — | title, score, author, age | entry point |
| getBestStories | browse highest-voted | — | title, score, author, age | entry point |
| getAskStories | browse Ask HN | — | title, score, author, age | entry point |
| getShowStories | browse Show HN | — | title, score, author, age | entry point |
| getJobPostings | browse jobs | — | title, age | no score/author |
| getFrontPageStories | time-based front page | — | title, score, author, age | entry point |
| getStoryDetail | view story + comments | id (item ID) | title, url, score, commentCount, comments | adapter |
| getStoryComments | get comment thread | id (item ID), limit? | storyId, commentCount, comments | adapter, default limit 50 |
| getUserProfile | view user profile | id ← known username | user, karma, created, about | adapter |
| getNewComments | newest comments | — | author, age, text, indent | entry point, adapter |
| getStoriesByDomain | stories from domain | site (e.g. "github.com") | title, score, author, age | adapter |
| getUserSubmissions | user's stories | id ← getUserProfile | title, score, author, age | adapter |
| getUserComments | user's comments | id ← getUserProfile | author, age, text, indent | adapter |

## Quick Start

```bash
# Browse top stories
openweb hackernews exec getTopStories '{}'

# Get story detail with comments
openweb hackernews exec getStoryDetail '{"id": 42407357}'

# Get just the comments (limited)
openweb hackernews exec getStoryComments '{"id": 42407357, "limit": 10}'

# Look up a user
openweb hackernews exec getUserProfile '{"id": "pg"}'

# User's submitted stories
openweb hackernews exec getUserSubmissions '{"id": "pg"}'

# Stories from a domain
openweb hackernews exec getStoriesByDomain '{"site": "github.com"}'

# Latest comments site-wide
openweb hackernews exec getNewComments '{}'
```

---

## Site Internals

## API Architecture
- No JSON API — all data is server-rendered HTML
- Single server: `news.ycombinator.com`
- Feed pages share identical DOM (`.athing` rows with `.titleline`, `.score`, `.hnuser`, `.age`)
- Item pages: story header + `.comtr` comment rows with indent via `.ind img[width]`
- User pages: `<table>` with label/value rows

## Auth
No auth required for all read operations. Cookie session declared at site level for transport consistency. Upvote/login write ops not implemented.

## Transport
- `page` — browser-based extraction (DOM parsing requires rendered page)
- Feed ops (7): `html_selector` extraction on browser tabs matching `page_url`
- Adapter ops (7): navigate to target URL via `page.goto()`, extract with `page.evaluate()`

## Known Issues
- Feed html_selector ops require the correct page to be loaded (page_url matching)
- Last story on some feed pages may have null score/author (ad or announcement row)
- Comment indent calculated from `.ind img[width]` attribute (40px per level)
- No bot detection — DOM extraction is reliable
- Feed ops don't return item IDs — only title, score, author, age
