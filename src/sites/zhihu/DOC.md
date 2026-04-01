# Zhihu (知乎)

## Overview
Chinese Q&A knowledge-sharing platform (Quora archetype). Users ask questions, write answers, publish articles, and follow topics.

## Workflows

**Discover answers by search:**
`searchContent` → `getMember` (author url_token from results) → `getUserAnswers`

**Explore a user's network:**
`getMember` → `listMemberMutuals` → `listMemberActivities`

**Find related content:**
`searchContent` → `listSimilarQuestions` (question ID from results) → `listQuestionFollowers`

**Engage with content (write):**
`searchContent` → `upvoteAnswer` (answer ID from results)
`getMember` → `followUser` (url_token from profile)
`searchContent` → `followQuestion` (question ID from results)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| **searchContent** | Search questions/answers/articles | `q` | data[].object.{id, question, author, excerpt} | Entry point |
| **getHotSearch** | Trending search terms | — | hot_search_queries[].{query, display_query} | Entry point |
| **getFeedRecommend** | Personalized homepage feed | — | data[].target.{question, author, voteup_count} | Entry point |
| **getMe** | Current user info | — | id, name, follower_count, answer_count | Entry point |
| **getMember** | User profile details | `url_token` ← searchContent author | name, headline, follower_count, answer_count |
| **getUserAnswers** | List user's answers | `url_token` ← getMember | data[].{question, voteup_count, content, excerpt} |
| **listMemberActivities** | User's recent activity | `url_token` ← getMember | data[].{verb, target.{title, author}} |
| **listMemberMutuals** | Mutual followers | `url_token` ← getMember | data[].{name, url_token, answer_count} |
| **listQuestionFollowers** | Users following a question | `id` ← searchContent question | data[].{name, url_token, headline} |
| **listSimilarQuestions** | Related questions | `id` ← searchContent question | data[].{title, answer_count, follower_count} |
| **getEntityWord** | Answer annotations | `token` (answer ID) | search_words[].{name, link, entity_class} |
| **upvoteAnswer** | Upvote an answer | `answer_id` ← searchContent | voting status | write/caution |
| **followUser** | Follow a user | `url_token` ← getMember | is_following | write/caution |
| **followQuestion** | Follow a question | `question_id` ← searchContent | is_following | write/caution |

## Quick Start

```bash
# Search questions and answers
openweb zhihu exec searchContent '{"q": "人工智能"}'

# Get trending hot search terms
openweb zhihu exec getHotSearch '{}'

# Get user profile (url_token from search results)
openweb zhihu exec getMember '{"url_token": "excited-vczh"}'

# List user's answers
openweb zhihu exec getUserAnswers '{"url_token": "excited-vczh"}'

# Get recommended feed
openweb zhihu exec getFeedRecommend '{}'

# Get current user info
openweb zhihu exec getMe '{}'
```

---

## Site Internals

### API Architecture
- **Base URL**: `https://www.zhihu.com`
- **API versions**: v3, v4 coexist — newer endpoints use v4
- **Response format**: JSON with `{ data, paging }` envelope for lists
- **Pagination**: Cursor-based via `offset` + `limit` or `paging.next` URL
- **Path parameters**: `url_token` for users (e.g. "excited-vczh"), numeric IDs for questions/topics

### Auth
- Type: `cookie_session` with CSRF
- CSRF: `_xsrf` cookie → `x-xsrftoken` header
- Auth cookie: `z_c0` — login required for most operations
- Some read endpoints return reduced data without login

### Transport
- `transport: page` (L3 adapter) — all operations use browser-mediated fetch
- API calls via `page.evaluate(fetch(...))` to inherit browser cookies
- Browser JS handles request signing automatically
- Adapter: `adapters/zhihu-web.ts`

### Known Issues
- No clean question detail API — question text is embedded in SSR page HTML
- Answer content is HTML-rich; API returns sanitized HTML
- Rate limiting is aggressive — space requests
- `include` parameter controls response fields — omitting returns minimal data
- Comments API exists but was not captured
- Topic APIs return error 10003 — require additional signing headers (x-zse-93, x-zse-96)
