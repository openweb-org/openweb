# Zhihu (知乎)

## Overview
Chinese Q&A and knowledge-sharing platform (similar to Quora). Users ask questions, write answers, publish articles, and follow topics. The platform has a rich internal API used by its SPA frontend.

## Quick Start

```bash
# Search questions and answers
openweb zhihu exec searchContent '{"q": "人工智能"}'

# Get trending hot search terms
openweb zhihu exec getHotSearch '{}'

# Get recommended feed
openweb zhihu exec getFeedRecommend '{}'

# Get user profile
openweb zhihu exec getMember '{"url_token": "zhang-jia-wei"}'

# Get current user info
openweb zhihu exec getMe '{}'

# List user's answers
openweb zhihu exec getUserAnswers '{"url_token": "zhang-jia-wei"}'

# List similar questions
openweb zhihu exec listSimilarQuestions '{"id": 35931336}'

# List user activities
openweb zhihu exec listMemberActivities '{"url_token": "zhang-jia-wei"}'
```

## Operations

| Operation | Intent | Method | Path | Notes |
|-----------|--------|--------|------|-------|
| searchContent | Search questions/answers/articles | GET | /api/v4/search_v3 | Returns paginated results with excerpts |
| getMember | Get user profile details | GET | /api/v4/members/{url_token} | Follower count, answer count, headline |
| getUserAnswers | List user's answers | GET | /api/v4/members/{url_token}/answers | Paginated, sortable by created/voteups |
| getHotSearch | Get trending search topics | GET | /api/v4/search/hot_search | Current hot keywords with heat scores |
| getMe | Current user info | GET | /api/v4/me | Name, avatar, follower/answer counts |
| getFeedRecommend | Get homepage feed | GET | /api/v3/feed/topstory/recommend | Personalized recommendation feed |
| listMemberActivities | Get user's recent activity | GET | /api/v3/moments/{url_token}/activities | Answers, upvotes, follows timeline |
| listMemberMutuals | Mutual followers | GET | /api/v4/members/{url_token}/relations/mutuals | Shared connections |
| getAnswerRelationship | Answer vote status | GET | /api/v4/answers/{id}/relationship | Voting/bookmark status |
| getEntityWord | Answer annotations | GET | /api/v3/entity_word | Knowledge cards, linked topics |
| listQuestionFollowers | Question followers | GET | /api/v4/questions/{id}/concerned_followers | Users following a question |
| listSimilarQuestions | Get related questions | GET | /api/v4/questions/{id}/similar-questions | Questions with answer/follower counts |
| upvoteAnswer | Upvote an answer | POST | /api/v4/answers/{answer_id}/voters | Reversible (send "neutral" to undo) |
| followUser | Follow a user | POST | /api/v4/members/{url_token}/followers | Reversible (DELETE to unfollow) |
| followQuestion | Follow a question | POST | /api/v4/questions/{question_id}/followers | Reversible (DELETE to unfollow) |
| followTopic | Follow a topic | POST | /api/v4/topics/{topic_id}/followers | Reversible (DELETE to unfollow) |

## API Architecture

- **Base URL**: `https://www.zhihu.com`
- **API versions**: v3, v4, v5.1 coexist — newer endpoints use higher versions
- **Response format**: JSON with consistent `{ data, paging }` envelope for lists
- **Pagination**: Cursor-based via `offset` + `limit` or `paging.next` URL
- **Path parameters**: `url_token` for users (e.g. "excited-vczh"), numeric IDs for questions/topics
- Some endpoints also accessible on `api.zhihu.com`

## Auth

- Type: `cookie_session` with CSRF
- CSRF: `_xsrf` cookie → `x-xsrftoken` header
- Login required for most operations — some read endpoints return reduced data without login
- Session cookies from browser profile; auth cookie is `z_c0`
- No explicit API key or OAuth token needed

## Transport

- `transport: page` (L3 adapter) — all operations use browser-mediated fetch
- Zhihu uses cookie-based session auth; direct HTTP calls without cookies return 401 or redirects
- All API calls are made via `page.evaluate(fetch(...))` to inherit browser cookies and headers
- Browser's JS handles request signing automatically
- L3 adapter: `adapters/zhihu-web.ts`

## Known Issues

- Question detail page (`/question/{id}`) uses SSR + client-side hydration; no clean API endpoint for full question data — question text is embedded in the page HTML
- Answer content is HTML-rich with inline images; the API returns sanitized HTML
- Rate limiting is aggressive — space requests
- Some user profiles may be private, returning 403
- `include` parameter controls which fields are returned — omitting it returns minimal data
- Comments API exists but was not captured in this discovery
- Topic APIs (getTopicIntro, getTopicFeed, getTopicChildren) removed — Zhihu now returns error 10003 ("request parameters abnormal"), likely requiring additional request signing headers (x-zse-93, x-zse-96)
