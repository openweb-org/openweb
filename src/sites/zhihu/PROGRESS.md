## 2026-03-28: Clean rediscovery

**What changed:**
- Compiled 7 HTTP operations from 95 initial clusters (heavy curation)
- Auth: cookie_session with CSRF (_xsrf → x-xsrftoken), Transport: node
- Operations: searchContent, getHotSearches, getRecommendFeed, getQuestionAnswers, getSimilarQuestions, getUserProfile, getMe

**Why:**
- Clean rediscovery for pipeline v2 comparison
- Topic endpoints (4 ops) excluded — need x-zse custom signing not available in node transport

**Verification:** 7/7 operations return real data via exec
