# CNN Progress

## 2026-04-09: Polish

**What changed:** openapi.yaml schema improvements — added descriptions to all response objects and properties, added missing `page_url` on searchArticles extraction, added `count` to searchArticles required fields. No bare `type: object` remaining.

**Why:** Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify cnn`

## 2026-04-09: Initial add

**What changed:** Added 3 operations (getHeadlines, getArticle, searchArticles) all using page_global_data extraction. Headlines and search use DOM card selectors; articles use LD+JSON NewsArticle data.

**Why:** CNN is a major US news source. Heavy bot detection (Cloudflare + DataDome + PerimeterX) requires page transport — no viable node/API path.

**Verification:** 3/3 PASS with `pnpm --silent dev verify cnn`
