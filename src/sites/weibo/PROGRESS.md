# Weibo Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created weibo with 10 operations covering trending, search, post detail, comments, user profiles
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md, adapters/weibo-web.ts

**Why:**
- Weibo is China's largest microblogging platform (500M+ users)
- Key use cases: monitor trending topics, search posts, get post detail with comments, view user profiles

**Discovery process:**
1. Browsed Weibo systematically via CDP (homepage, hot search, trending, search, post detail x3, user profiles x2, discover)
2. Captured 692 network requests across multiple page navigations
3. Identified 10 distinct AJAX API endpoints under `/ajax/` namespace
4. All operations require cookie-based authentication (SUB + XSRF-TOKEN)
5. Created L3 adapter (weibo-web.ts) using page.evaluate() fetch for all operations

**Key endpoints discovered:**
- `/ajax/side/hotSearch` — hot search ranking with 50 topics
- `/ajax/side/searchBand` — trending sidebar (similar data, different context)
- `/ajax/feed/hottimeline` — popular posts feed with cursor pagination
- `/ajax/statuses/show?id=` — full post detail with long text
- `/ajax/statuses/buildComments?id=` — post comments with cursor pagination
- `/ajax/profile/info?uid=` — user profile data
- `/ajax/profile/detail?uid=` — extended user metadata (IP location, birthday)
- `/ajax/statuses/mymblog?uid=` — user's posts timeline
- `/ajax/side/search?q=` — sidebar search results
- `s.weibo.com/ajax_Indexband/getIndexBand` — categorized trending lists

**Verification:** Pending formal verify — data structures confirmed from captured responses.
