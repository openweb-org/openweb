# TikTok Discovery Notes

## Target Operations (all blocked)
1. **searchVideos**: search videos by keyword
2. **getVideoDetail**: get video detail/metadata
3. **getUserProfile**: get user profile

## Architecture Findings

### Content Delivery: SSR via `__UNIVERSAL_DATA_FOR_REHYDRATION__`
TikTok serves core content via server-side rendering. A `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` tag (253KB) contains:
- Search results (video list, user list, hashtag list)
- Video detail metadata (description, stats, author info)
- User profile data (bio, follower counts, video list)

No separate API calls are made for these — the data is embedded in the initial HTML response.

### Anti-Bot Signing: X-Bogus, X-Gnarly, msToken
Every TikTok API request includes three client-side computed parameters:
- **X-Bogus**: Anti-bot signature, computed by obfuscated JS (virtual-machine-based bytecode interpreter)
- **X-Gnarly**: Additional signature parameter
- **msToken**: Dynamic session token

These cannot be reproduced outside the browser context. They are appended as query parameters to every API URL.

### API Endpoints Discovered (internal, not target operations)
| Endpoint | Description | Response |
|----------|-------------|----------|
| `/api/search/general/full/` | Search API | 200, but **empty body** in HAR capture |
| `/api/search/suggest/guide/` | Search suggestions | 200, empty body |
| `/api/feedback/v1/newest_reply/` | Feedback replies | 200, 169B |
| `/api/user/following/request/list/` | Follow requests | 200, 285B |
| `/api/notice/multi/` | Notifications | 200, 204B |
| `/webcast/feed/` | Live feed | 200, 273B |
| `/tiktok/popup/dispatch/v1` | Popup dispatch | 200, 187B |

### Auth Pattern
- **cookie_session**: Logged-in session uses many cookies (4056 captured)
- Meta tag `pumbaa-ctx` indicates login state: `login=1`
- Session managed via `ttwid`, `sessionid`, `sid_tt` cookies

### Domains
- `www.tiktok.com` — main site + API
- `webcast.us.tiktok.com` — webcast/live API
- `mcs.tiktokw.us` — metrics/monitoring
- `mon16-normal-useast5.tiktokv.us` — monitoring
- `analytics.tiktok.com` — analytics

## Path to Unblock (L3 Adapter)
An L3 adapter would need:
1. **browser_fetch transport**: Execute API calls from within the browser context so X-Bogus/X-Gnarly are computed by TikTok's JS
2. **SSR extraction**: `page.evaluate()` to read `__UNIVERSAL_DATA_FOR_REHYDRATION__` from the DOM after navigation
3. **Page navigation**: Navigate to search/video/profile URLs and extract SSR data

This is similar to how X/Twitter uses `browser_fetch` for TLS fingerprint requirements, but more complex due to the SSR extraction needs.
