## 2026-04-24: Userflow QA — L3 adapter for response trimming

**Personas tested:**
1. Commuter — browse programs, get episode list (searchArticles)
2. News reader — get top stories, search by topic (getTopStories, searchArticles)
3. Local follower — check station content, local coverage (searchArticles with filters)

**Gaps found:**
- Response bloat (all 3 ops): Algolia returns internal fields (_highlightResult, _snippetResult, collectionIds, profileIds, lastIngestDateTime, services, thumbnail, blogs, series, etc.) inflating responses to 131–269KB
- bodyText in list ops: getTopStories returned full article body (4–5KB/item) instead of teaser

**What changed:**
- Added L3 adapter `adapters/npr.ts` with nodeFetch → response trimming for all 3 ops
- List ops (searchArticles, getTopStories): strip Algolia internals, truncate bodyText to 300-char teaser
- Detail op (getArticle): strip Algolia internals, keep full bodyText
- openapi.yaml: wired adapter refs for all 3 ops, removed unwrap (adapter handles hits extraction)
- manifest.json: l1_count 3→0, l3_count 0→3

**Result:**
- getTopStories: 138KB → 13KB (91% reduction)
- searchArticles: 242KB → 10KB (96% reduction)
- getArticle: 7KB → 6KB (14% reduction, already lean)

**Verification:** `pnpm --silent dev verify npr`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (## → ###)
- openapi.yaml: added `required` arrays to all nested objects (displayDate, image, slug)
- openapi.yaml: added descriptions to all bare properties (caption, credit, getTopStories fields)
- openapi.yaml: added `example` values to filters, hitsPerPage, page params
- openapi.yaml: eliminated bare `type: object` — all nested objects have descriptions
- All 3 example files present and correct

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify npr`
