## 2026-03-28: Clean rediscovery

**What changed:**
- Compiled 8 HTTP operations for 5 target intents (trending, user profile, user posts, post detail, search)
- Auth: cookie_session with XSRF-TOKEN CSRF, Transport: page
- Removed 27 noise operations (telemetry, config, ads, sidebar, logging)
- Fixed CSRF detection (pipeline picked `_s_tentry` -> `:authority`, corrected to `XSRF-TOKEN` -> `x-xsrf-token`)
- Fixed getHotTimeline schema (statuses at root, not nested in data)
- Removed getTrendingBand (s.weibo.com cross-origin issues, redundant with getHotSearch)

**Why:**
- Clean rediscovery from scratch for quality comparison with previous 14-op spec

**Verification:** 7/8 operations return real data via exec (getHotTimeline initially 400, fixed with extparam). All target intents covered.
