# Weibo Pipeline Gaps

## 2026-04-02: Schema fix — malformed YAML and cycle-breaking

### Problem

Ajv schema compilation failed for 8/14 operations. Three issues:

1. **Malformed `pic_ids.items`** — YAML `type:\n  type: object` parsed as `{type: {type: "object"}}` instead of `{type: "string"}`. Affected: getFriendsFeed, getHotFeed, getUserStatuses, getPost, listReposts, likePost, repost, bookmarkPost.

2. **Malformed `pic_infos.additionalProperties`** — Same nested-type bug plus `properties: type: object` creating a bare object instead of actual image properties.

3. **Bare `retweeted_status: type: object`** — No properties, violates the "no bare type:object" rule. Circular reference (post contains reposted post) was left unresolved.

### Fix

- `pic_ids.items`: changed to `type: string` (Weibo photo IDs are strings)
- `pic_infos.additionalProperties`: replaced with typed image object (thumbnail/bmiddle/large/original with url/width/height, plus pic_id, photo_tag, type)
- `retweeted_status`: inlined a cycle-broken post schema with basic fields (id, mid, text, user, engagement counts, pic_ids) — no further nesting

### Result

- 14/14 schemas compile with Ajv (`strict: false, allErrors: true`)
- 0 `$ref` pointers remain in spec
- 0 bare `type: object` schemas remain

### Remaining gap

- **Runtime verify blocked**: all 10 verifiable operations fail with `CDP connection refused`. Weibo uses `page` transport (cookie_session auth) requiring Chrome with `--remote-debugging-port=9222` and valid Weibo session cookies. Cannot verify response shapes without a live browser session.
- **4 write operations** (likePost, repost, followUser, bookmarkPost) skipped by verify (unsafe mutations).
