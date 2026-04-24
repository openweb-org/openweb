# CNN Progress

## 2026-04-24: Userflow QA — adapter migration, video page fix, response trimming

**What changed:**
- Migrated all 3 operations from `page_global_data` extraction to L3 adapter (`src/sites/cnn/adapters/cnn.ts`)
- **P0 fix:** `getArticle` on video pages (no LD+JSON) — added meta tag fallback (`og:title`, `og:description`, `author`, `meta-section`, `og:image`); video pages now return title/description/section/thumbnail instead of hard-failing
- **P2 fix:** `getHeadlines` response trimming — capped at 25 items (was 72, ~12KB uncapped)
- Added `page_plan.entry_url` to each operation for correct page navigation (prevents SPA page-reuse mismatch)
- Updated `manifest.json` stats: `l2_count: 0`, `l3_count: 3`
- Bumped `tool_version` to 2, signals to `adapter-verified` for all 3 ops

**QA personas tested:**
1. Morning reader: getHeadlines → getArticle (article slug) — PASS
2. Political follower: searchArticles "election 2026" → getArticle (politics slug) — PASS
3. Business reader: searchArticles "stock market economy" → getArticle (investing slug) — PASS
4. Edge: getArticle on video slug — PASS (meta tag fallback)
5. Edge: getArticle on live-story slug — PASS (LD+JSON, body: null expected)
6. Edge: searchArticles with pagination (size=5, page=2) — PASS

**Known limitations:**
- Video pages return `body: null` (no text content to extract)
- Live-story pages return `body: null` (dynamic content not in LD+JSON)

**Verification:** `pnpm dev verify cnn`

## 2026-04-09: Polish

**What changed:** openapi.yaml schema improvements — added descriptions to all response objects and properties, added missing `page_url` on searchArticles extraction, added `count` to searchArticles required fields. No bare `type: object` remaining.

**Why:** Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify cnn`

## 2026-04-09: Initial add

**What changed:** Added 3 operations (getHeadlines, getArticle, searchArticles) all using page_global_data extraction. Headlines and search use DOM card selectors; articles use LD+JSON NewsArticle data.

**Why:** CNN is a major US news source. Heavy bot detection (Cloudflare + DataDome + PerimeterX) requires page transport — no viable node/API path.

**Verification:** 3/3 PASS with `pnpm --silent dev verify cnn`
