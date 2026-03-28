# Zhihu

## Overview
Zhihu (知乎) — China's largest Q&A knowledge platform. Chinese Web archetype.

## Quick Start

```bash
# Search for content
openweb zhihu exec searchContent '{"q": "人工智能", "t": "general", "limit": 10}'

# Get trending search terms
openweb zhihu exec getHotSearches '{}'

# Get homepage recommended feed
openweb zhihu exec getRecommendFeed '{"limit": 10}'

# Get answers for a question
openweb zhihu exec getQuestionAnswers '{"id": 19551424, "limit": 5}'

# Get similar questions
openweb zhihu exec getSimilarQuestions '{"id": 19551424}'

# Get user profile
openweb zhihu exec getUserProfile '{"username": "excited-vczh"}'

# Get current user (requires auth)
openweb zhihu exec getMe '{}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchContent | Search by keyword | GET /api/v4/search_v3 | Returns answers, articles, topics. Param `t` controls type (general/topic/people) |
| getHotSearches | Trending searches | GET /api/v4/search/hot_search | No params needed, returns ranked hot queries |
| getRecommendFeed | Homepage feed | GET /api/v3/feed/topstory/recommend | Paginated with `page_number` or `after_id` |
| getQuestionAnswers | Question answers | GET /api/v4/questions/{id}/feeds | Paginated, `order`: default or updated |
| getSimilarQuestions | Related questions | GET /api/v4/questions/{id}/similar-questions | Small result set |
| getUserProfile | User profile | GET /api/v4/members/{username} | `include` param controls extra fields |
| getMe | Current user | GET /api/v4/me | Requires auth cookies |

## API Architecture
- REST JSON APIs on `www.zhihu.com/api/v3/` and `www.zhihu.com/api/v4/`
- Paginated responses use `paging.next` URL or `offset`/`limit` params
- SSR HTML pages exist at `/question/{id}`, `/people/{username}` but we use the JSON APIs instead
- Some endpoints (topics) require additional `x-zse-93`/`x-zse-96` custom signing headers

## Auth
- Type: `cookie_session` with CSRF (`_xsrf` cookie → `x-xsrftoken` header)
- Most read operations work without auth (search, feed, answers, profile)
- `getMe` requires auth cookies
- Topic detail/feed/answerer endpoints require auth + custom x-zse signing (not yet supported)

## Transport
- `node` — works for the 7 curated operations
- Topic API endpoints need custom request signing (`x-zse-93`, `x-zse-96`) that only the browser can compute. These are excluded pending adapter implementation.

## Known Issues
- **x-zse signing**: Zhihu uses proprietary `x-zse-93` and `x-zse-96` headers on topic endpoints. These are computed client-side and cannot be replicated in node transport. Requires page transport with adapter extraction.
- **Rate limiting**: Aggressive — avoid high request rates
- **ID types**: Zhihu returns IDs as strings in JSON even for numeric question/answer IDs
- **Search results**: Include gaokao (college exam) and ad cards mixed with real results — filter by `type: "search_result"` for clean results
