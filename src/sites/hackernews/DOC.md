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
| unvoteStory | reverse upvote | id | ok, id | adapter (page) |
| addComment | post comment | parent, text | ok, parent, id | adapter (page) |
| deleteComment | delete own comment | id | ok, id | adapter (page) |

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

# Reverse the upvote (only valid while currently upvoted)
openweb hackernews exec unvoteStory '{"id": 42407357}'

# Comment on a story (requires browser + login)
openweb hackernews exec addComment '{"parent": 42407357, "text": "Great article!"}'

# Delete your own comment (HN ~2-hour window)
openweb hackernews exec deleteComment '{"id": 47830121}'
```

---

## Site Internals

## API Architecture
- **Reads**: Two public APIs, no auth required:
  - **Algolia** (`hn.algolia.com/api/v1/`): search, feeds, story detail with nested comments
  - **Firebase** (`hacker-news.firebaseio.com/v0/`): item detail, user profiles
- **Writes**: Form-based submission to `news.ycombinator.com` — no public write API

## Auth
No auth for reads. Write operations (`upvoteStory`, `unvoteStory`, `addComment`, `deleteComment`) require a logged-in cookie session in the browser. HN issues per-(user, item) HMAC tokens that must be scraped from rendered HTML — there is no general-purpose CSRF cookie.

## Transport
- **14 node ops total**: All read ops use node transport — no browser needed
  - 10 L1 declarative node ops: Direct HTTP to Algolia/Firebase
  - 4 adapter node ops: Node.js `fetch` to Algolia via adapter (parameterized queries that need value composition)
- **4 adapter write ops**: `page.evaluate(fetch(...))` with DOM extraction for HMAC tokens (upvote/unvote/addComment/deleteComment)

## Adapter Patterns

### Per-(user, item) HMAC scraping for vote/unvote

HN's vote and unvote links live next to the item in the listing/item HTML and embed a per-(user, item) HMAC `auth` token directly in the URL:

```
#up_{itemId}  → vote?id={itemId}&how=up&auth={hmac}&goto=...
#un_{itemId}  → vote?id={itemId}&how=un&auth={hmac}&goto=...
```

The `auth` value is identical for both `how=up` and `how=un` on a given (user, item) pair, but only one of the two anchors is rendered at a time:
- `#up_{id}` appears when the user has not voted (or after unvote)
- `#un_{id}` appears only after a successful upvote

Adapter strategy: navigate to `/item?id={itemId}`, then `document.querySelector('#up_{id}' | '#un_{id}')` and `fetch(href, { credentials: 'include' })`. No token caching — every call re-scrapes because the token is short-lived and per-page.

### Comment form HMAC + new-comment id discovery

`addComment` POSTs to `/comment` form-encoded with `parent`, `text`, `goto`, `hmac`. The `hmac` is a hidden `<input>` inside `form[action="comment"]` on the parent item page — separate from the vote HMAC.

The POST response is an HTML redirect that does not include the new comment's id. To enable `${prev.addComment.id}` chaining, the adapter reads `#me` for the logged-in username, then fetches `/threads?id={username}` and parses the first `<tr class="athing comtr" id="...">` — the user's most recent comment. This is reliable as long as no other comment is posted by the same account between the two requests.

### Delete flow uses `/xdelete`, not `/delete`

`deleteComment` follows a confirm-then-submit pattern:

1. `GET /delete-confirm?id={commentId}&goto=...` returns an HTML form with hidden `hmac`.
2. `POST /xdelete` form-encoded with `id`, `goto`, `hmac`, `d=Yes`.

**Pitfall:** the obvious URL `/delete` returns 404 — only `/xdelete` accepts the POST. The form's `action="/xdelete"` is the canonical source of truth; do not infer the endpoint from the path of the confirm step.

The delete-confirm step also fails if the comment is outside HN's ~2-hour delete window (the form simply omits the `hmac` input), so the adapter throws a clear error in that case.

## Known Issues
- Algolia data has ~30s delay from HN (near-real-time, not instant)
- Firebase `user.submitted` returns all IDs (can be thousands) — Algolia is more efficient for user activity
- No bot detection from any API
- Write ops still need DOM for auth token extraction (no alternative)
