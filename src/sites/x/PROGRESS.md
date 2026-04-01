## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered x.com (Twitter) GraphQL API from scratch
- Captured traffic via UI browsing: timeline, search, profiles, followers, tweet detail
- Captured write ops: like/unlike, bookmark/unbookmark, retweet/unretweet
- Compiled 15 curated operations from 50 raw clusters (35 noise removed)
- Configured page transport + ct0 CSRF with ALL-methods scope

**Why:**
- First full site package for x.com

**Verification:** openweb verify x — page transport with browser
**Commit:** pending
