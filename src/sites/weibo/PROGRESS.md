## 2026-04-02: Fix malformed schemas (Ajv compilation)

**What changed:**
- Fixed `pic_ids.items` — malformed YAML `type: type: object` → `type: string`
- Fixed `pic_infos.additionalProperties` — replaced broken nesting with typed image object (thumbnail/bmiddle/large/original)
- Fixed `retweeted_status` — inlined cycle-broken post schema with basic properties instead of bare `type: object`

**Why:**
- 8/14 operations failed Ajv compilation due to malformed schemas from prior $ref inlining
- Bare `type: object` on retweeted_status violated spec verify rules

**Verification:** 14/14 Ajv compile pass. Runtime verify pending (page transport, needs CDP browser).

## 2026-04-01: Enrich response schemas

**What changed:**
- Replaced 15 bare `type: object` response schemas with `$ref` to WeiboPost/WeiboUser or inline properties
- Added properties to: tabList items, sunshine_credit, education, url_struct items
- Component schemas (WeiboPost.user, WeiboPost.retweeted_status) now use `$ref`

**Why:**
- Spec Verify requires no bare `type: object` for ops returning structured JSON
- Agents need typed schemas to understand response shapes without runtime probing

**Verification:** Spec Verify pass, Doc Verify pass. Runtime Verify pending (page transport, no browser available).

## 2026-03-29: Initial compile

**What changed:**
- 14 operations: 6 read feeds/posts, 4 user/profile, 4 write (like, repost, follow, bookmark)
- Page transport with cookie_session auth + XSRF-TOKEN CSRF
- Full adapter (weibo-web.ts) for all operations
- DOC.md with 4 workflows, operations table, quick start

**Why:**
- Initial site package for Weibo (China's Twitter/X equivalent)

**Verification:** Compiled from HAR capture. Runtime verified with browser session.
