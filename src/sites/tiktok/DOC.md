# TikTok

## Overview
TikTok — short-form video platform. **BLOCKED** — no compiled operations. Anti-bot signing prevents API replay.

## Operations
None compiled. Target operations (all blocked):
- `searchVideos` — search videos by keyword
- `getVideoDetail` — video detail/metadata
- `getUserProfile` — user profile

## API Architecture
- **SSR-only content delivery**: core data (search results, video details, profiles) served in `__UNIVERSAL_DATA_FOR_REHYDRATION__` script tag (~253KB), not via separate API calls
- Internal API endpoints exist (`/api/search/general/full/`, etc.) but return empty bodies in capture — protected by signing

## Auth
- `cookie_session` with extensive cookie set (~4056 cookies captured)
- Session cookies: `ttwid`, `sessionid`, `sid_tt`
- Login state indicated by `pumbaa-ctx` meta tag (`login=1`)

## Anti-Bot
- **X-Bogus**: signature computed by obfuscated VM-based bytecode interpreter in client JS
- **X-Gnarly**: additional anti-bot signature
- **msToken**: dynamic session token
- All three appended as query params to every API request — cannot be reproduced outside browser

## Domains
- `www.tiktok.com` — main site + API
- `webcast.us.tiktok.com` — live/webcast API
- `mcs.tiktokw.us`, `mon16-normal-useast5.tiktokv.us` — monitoring

## Path to Unblock
Requires L3 adapter with:
1. `browser_fetch` transport — API calls from within browser context (X-Bogus computed by TikTok's JS)
2. SSR extraction — `page.evaluate()` to read `__UNIVERSAL_DATA_FOR_REHYDRATION__` from DOM
3. Page navigation to search/video/profile URLs

## Known Issues
- Site is **blocked** and **quarantined**
- No operations can be compiled until L3 adapter is built
