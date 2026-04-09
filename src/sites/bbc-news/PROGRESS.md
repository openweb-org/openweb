## 2026-04-09: Initial add — 4 operations

**What changed:**
- Added BBC News site with 4 operations: getHeadlines, getArticle, searchArticles, getTopicFeed
- All operations use `page_global_data` extraction from `__NEXT_DATA__`
- Transport: `page` (Cloudflare bot detection blocks node)

**Why:**
- BBC News is a major global news source with rich SSR data

**Verification:** 4/4 PASS with `pnpm --silent dev verify bbc-news --browser`
