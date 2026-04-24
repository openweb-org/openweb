## 2026-04-24: Userflow QA — fix topic enum, cap responses, fix search page

**What changed:**
- getTopicFeed: replaced broken enum [world, business, innovation, culture, arts, travel] with verified [world, uk, business, technology, health]. The dropped topics live at bbc.com root level, not under /news/
- getHeadlines + getTopicFeed: capped items at 25 in extraction expressions (was 34 and 75 uncapped). Filters newsletter promo items from topic feeds
- searchArticles: fixed response page off-by-one — BBC returns 0-indexed page internally, now normalized to 1-indexed to match input
- DOC.md: updated topic lists and known issues

**Why:**
- 3-persona blind QA: global citizen (headlines → article → world), student (search → article), expat (topic → headlines). 4/6 topic enum values returned empty. Business feed had 75 items (22KB). Search page=0 when user expects page=1

**Verification:** `pnpm --silent dev verify bbc-news`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals
- openapi.yaml: added param examples, required fields, property descriptions, no bare type:object
- All 4 example files present and correct

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify bbc-news`

## 2026-04-09: Initial add — 4 operations

**What changed:**
- Added BBC News site with 4 operations: getHeadlines, getArticle, searchArticles, getTopicFeed
- All operations use `page_global_data` extraction from `__NEXT_DATA__`
- Transport: `page` (Cloudflare bot detection blocks node)

**Why:**
- BBC News is a major global news source with rich SSR data

**Verification:** 4/4 PASS with `pnpm --silent dev verify bbc-news --browser`
