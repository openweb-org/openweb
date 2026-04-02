## Pipeline Gaps — Reuters (2026-04-02)

### Noise ops removed

**Action taken:** Deleted 7 noise operations and their example files: `getServiceCfGeo`, `getSophiWebConfig`, `getSiteApiManifest`, `getPfContentFetch`, `getPfContentFetch_2`, `get`, `createJs`. These were infrastructure/config endpoints captured during recording with no user-facing value. The spec already had only the 4 good ops; only the stale example files remained.

### All 4 ops require CDP browser (transport: page)

**Problem:** All operations (searchArticles, getArticle, getTopicArticles, getMarketQuotes) fail verify with `CDP connection refused`. The site uses `transport: page` — the adapter runs `fetch()` inside a Playwright browser page to access Reuters' internal PF API (`/pf/api/v3/content/fetch/*`). Without a Chrome instance running with `--remote-debugging-port=9222`, verify cannot execute.

**Root cause:** Reuters serves its content APIs through the same-origin browser session. The adapter design is correct — it uses `page.evaluate(fetch(...))` to call the PF endpoints with session cookies. But headless verify requires a running CDP target.

**Suggested fix:** Start Chrome with CDP before verify, or mark reuters as `requires_browser: true` (already set in manifest) and skip in headless CI. For local verify: `google-chrome --remote-debugging-port=9222 https://www.reuters.com &` then re-run verify.

### Build sync does not clean deleted files

**Problem:** `pnpm build` copies site packages to `~/.openweb/sites/` but does not remove files that were deleted from `src/sites/`. After removing the 7 noise example files from `src/sites/reuters/examples/`, they persisted in `~/.openweb/sites/reuters/examples/`, causing verify to still attempt those operations.

**Root cause:** `scripts/build-sites.js` uses additive copy (not sync-with-delete). Stale files in the target directory survive across builds.

**Suggested fix:** Either `rm -rf` the target site directory before copying, or use `rsync --delete`. This affects all sites, not just reuters.
