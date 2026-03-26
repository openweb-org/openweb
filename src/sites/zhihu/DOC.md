# Zhihu (知乎)

## Overview

Zhihu is China's largest Q&A platform (comparable to Quora). Users ask questions, write answers, publish articles, and follow topics. The platform has a rich internal API used by its SPA frontend.

## Operations

| Operation | Intent | Method | Path | Notes |
|-----------|--------|--------|------|-------|
| searchContent | Search questions/answers/articles | GET | /api/v4/search_v3 | Returns paginated results with excerpts |
| getUserProfile | Get user profile details | GET | /api/v4/members/{url_token} | Follower count, answer count, headline |
| getUserAnswers | List user's answers | GET | /api/v4/members/{url_token}/answers | Paginated, sortable by created/voteups |
| getHotSearch | Get trending search topics | GET | /api/v4/search/hot_search | Current hot keywords with heat scores |
| getTopicIntro | Get topic description | GET | /api/v4/topics/{topic_id}/intro | Topic abstract, categories, modules |
| getTopicFeed | Get topic's best content | GET | /api/v5.1/topics/{topic_id}/feeds/essence/v2 | Top-voted answers and articles |
| getSimilarQuestions | Get related questions | GET | /api/v4/questions/{question_id}/similar-questions | Questions with answer/follower counts |
| getRecommendFeed | Get homepage feed | GET | /api/v3/feed/topstory/recommend | Personalized recommendation feed |
| getUserActivities | Get user's recent activity | GET | /api/v3/moments/{url_token}/activities | Answers, upvotes, follows timeline |
| getTopicChildren | Get sub-topics | GET | /api/v3/topics/{topic_id}/children | Child topics under a parent |
| upvoteAnswer | Upvote an answer | POST | /api/v4/answers/{answer_id}/voters | ✅ SAFE — reversible (send "neutral" to undo) |
| followUser | Follow a user | POST | /api/v4/members/{url_token}/followers | ✅ SAFE — reversible (DELETE to unfollow) |
| followQuestion | Follow a question | POST | /api/v4/questions/{question_id}/followers | ✅ SAFE — reversible (DELETE to unfollow) |
| followTopic | Follow a topic | POST | /api/v4/topics/{topic_id}/followers | ✅ SAFE — reversible (DELETE to unfollow) |

## API Architecture

- **Base URL**: `https://www.zhihu.com`
- **API versions**: v3, v4, v5.1 coexist — newer endpoints use higher versions
- **Response format**: JSON with consistent `{ data, paging }` envelope for lists
- **Pagination**: Cursor-based via `offset` + `limit` or `paging.next` URL
- **Path parameters**: `url_token` for users (e.g. "excited-vczh"), numeric IDs for questions/topics

## Auth

- `requires_auth: false` — APIs work with active browser session cookies
- Auth type: `cookie_session` — the browser maintains session cookies automatically
- No explicit API key or OAuth token needed for read operations
- Some endpoints return reduced data without login (e.g. fewer feed items)

## Transport

- `transport: page` — all operations use browser-mediated fetch (L3)
- Zhihu uses cookie-based session auth; direct HTTP calls without cookies return 401 or redirects
- All API calls are made via `page.evaluate(fetch(...))` to inherit browser cookies and headers
- No explicit bot detection (Cloudflare, etc.) observed, but cookies are required

## Known Issues

- Question detail page (`/question/{id}`) uses SSR + client-side hydration; no clean API endpoint for full question data — question text is embedded in the page HTML
- Answer content is HTML-rich with inline images; the API returns sanitized HTML
- Rate limiting may apply to rapid sequential requests
- Some user profiles may be private, returning 403
- `include` parameter controls which fields are returned — omitting it returns minimal data
