# Medium — Pipeline Gaps

**Date:** 2026-04-02
**Verify command:** `pnpm --silent dev verify medium`

## Summary

- **Total ops:** 13 (10 read, 3 write)
- **Examples created:** 13/13
- **Verify result:** FAIL (quarantined) — all 10 read ops failed with CDP connection error

## Verify Results

### Read Operations (10/10 FAIL — infrastructure)

All read operations use `transport: page` which requires a CDP browser on `127.0.0.1:9222`. No browser was running during verify, so all failed with:

```
CDP connection failed after 3 attempts: browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222
```

| Operation | Status | Reason |
|---|---|---|
| searchArticles | FAIL | CDP not available |
| getArticle | FAIL | CDP not available |
| getTagFeed | FAIL | CDP not available |
| getTagCuratedLists | FAIL | CDP not available |
| getTagWriters | FAIL | CDP not available |
| getRecommendedFeed | FAIL | CDP not available |
| getRecommendedTags | FAIL | CDP not available |
| getPostClaps | FAIL | CDP not available |
| getRecommendedWriters | FAIL | CDP not available |
| getUserProfile | FAIL | CDP not available |

### Write Operations (3 — skipped, require auth)

| Operation | Status | Reason |
|---|---|---|
| clapArticle | SKIPPED | requires_auth: true |
| followWriter | SKIPPED | requires_auth: true |
| saveArticle | SKIPPED | requires_auth: true |

## Gaps

1. **No CDP browser available** — all Medium ops use `transport: page` (adapter-based GraphQL via browser). Verify needs a running Chrome instance (`--remote-debugging-port=9222`) to execute these ops.
2. **Write ops untestable without auth** — clapArticle, followWriter, saveArticle require authentication. No auth credentials are configured.
3. **Example postId may be stale** — the example postId `70d2a62246c0` is used for getArticle, getPostClaps, clapArticle, saveArticle. If this post is removed, those ops will fail even with a running browser.

## Next Steps

- Re-run verify with a CDP browser: `google-chrome --remote-debugging-port=9222 --headless`
- Validate example postId/username values are still live on Medium
- Consider adding auth flow documentation for write op testing
