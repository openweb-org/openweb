## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations with InnerTube POST pattern and SAPISIDHASH signing

**Verification:** spec review only — no new capture or compilation

## 2026-03-26: Expand from 2 to 8 operations

**What changed:**
- Added 6 new operations: searchVideos, browseContent, getTranscript, likeVideo, unlikeVideo, subscribeChannel
- Renamed getComments → getRelatedAndComments (returns both comments and related videos)
- Updated clientVersion to 2.20260324.05.00
- Documented browseId patterns (channel UC..., playlist VL..., home FEwhat_to_watch)
- Updated manifest.json to version 2.0.0 with 8 operations

**Why:**
- YouTube had only 2 ops (getVideoInfo, getComments), missing search, channel, playlist, like/subscribe
- Confirmed all InnerTube endpoints via browser-context fetch from youtube.com

**Verification:**
- API-level: all new endpoints tested from browser context with 200 responses (search, browse channel, browse playlist, browse home, like/like, subscription/subscribe)
- Like/like requires SAPISIDHASH auth header (confirmed working with crypto.subtle hash)
- Trending browseId (FEtrending) returns 400 — excluded from spec
- spec validation passes (openweb validates x-openweb schema)
- Verify command skips POST-only sites by default — documented as known limitation
