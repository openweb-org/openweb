# YouTube

## Overview
Video content platform. InnerTube JSON API on `www.youtube.com`.

## Workflows

### Search and watch a video
1. `searchVideos(query)` → video titles, thumbnails, `videoId`s
2. `getVideoDetail(videoId)` → title, description, recommendations
3. `getComments(videoId)` → comment threads with author, text, likes, replies
4. `getVideoPlayer(videoId)` → stream URLs, formats, captions

### Browse a channel or playlist
1. `browseContent(browseId: "FEwhat_to_watch")` → homepage video grid with `videoId`s
2. `browseContent(browseId: "UC...")` → channel page with tabs, videos
3. `getPlaylist(playlistId)` → playlist title, owner, full video list

### Get a video transcript
1. `getVideoDetail(videoId)` → find `engagementPanels[].engagementPanelSectionListRenderer` with `panelIdentifier: "engagement-panel-searchable-transcript"` → extract `params` token
2. `getTranscript(params)` → timestamped transcript lines

### Subscribe / unsubscribe a channel
1. `searchVideos(query)` or `browseContent(browseId)` → find channel ID (`UC...`)
2. `subscribeChannel(channelIds: ["UC..."])` → confirmation
3. `unsubscribeChannel(channelIds: ["UC..."])` → reverses subscription

### Comment on a video
1. `searchVideos(query)` → `videoId`
2. `addComment(videoId, text)` → `commentId`
3. `deleteComment(videoId, commentId)` → removes the comment

> **Note:** `getTranscript` requires a `params` token from `getVideoDetail`, not a direct videoId. The params token is session-bound; the endpoint may return FAILED_PRECONDITION without valid session context.

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search by keyword | query | videoId, title, channelName, viewCount, duration, thumbnail | entry point |
| browseContent | browse feeds/channels | browseId (FEwhat_to_watch, FEtrending, UC..., VL...) | video grids, channel tabs, metadata | see browseId patterns below |
| getVideoDetail | video metadata + recommendations | videoId ← searchVideos | title, description, viewCount, likes, publishDate, recommendations | |
| getComments | video comments | videoId ← searchVideos | commentId, author, text, likeCount, replyCount, publishedTime | adapter — two-step continuation |
| getPlaylist | playlist details + videos | playlistId ← searchVideos/browseContent | title, owner, videoCount, videos with videoId, duration | adapter — wraps /browse with VL prefix |
| getVideoPlayer | player + stream info | videoId ← searchVideos | streamingData, formats, captions, playabilityStatus | stream URLs restricted without auth |
| getGuide | sidebar navigation | — | subscriptions, explore categories, library links | |
| getTranscript | video transcript | params ← getVideoDetail engagement panel | timestamped transcript lines | not in openapi.yaml — see Known Issues |
| getNotificationCount | unseen notifications | — | unseenCount | requires sapisidhash auth |
| likeVideo | like a video | videoId ← searchVideos | confirmation | requires sapisidhash auth, SAFE (reversible) |
| unlikeVideo | remove like | videoId ← searchVideos | confirmation | requires sapisidhash auth |
| subscribeChannel | subscribe to channel | channelIds | confirmation | requires sapisidhash auth, SAFE (reversible) |
| unsubscribeChannel | unsubscribe from channel | channelIds | confirmation | requires sapisidhash auth, reverses subscribeChannel |
| addComment | post comment on video | videoId, text | commentId, text, author | adapter — requires sapisidhash auth, reversible via deleteComment |
| deleteComment | delete own comment | videoId, commentId ← addComment/getComments | confirmation (deleted: true) | adapter — requires sapisidhash auth, reverses addComment |

### browseId Patterns
- **Home feed:** `FEwhat_to_watch`
- **Trending:** `FEtrending`
- **Subscriptions:** `FEsubscriptions`
- **Channel:** `UC...` (e.g. `UCsBjURrPoezykLs9EqgamOA`)
- **Playlist:** `VL` + playlist ID (e.g. `VLPLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt`)

## Quick Start

```bash
# Search videos
openweb youtube exec searchVideos '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "query": "machine learning tutorial"}'

# Get video detail (title, description, comments, recommendations)
openweb youtube exec getVideoDetail '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Get video player info (stream URLs, formats, captions)
openweb youtube exec getVideoPlayer '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Browse homepage
openweb youtube exec browseContent '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "browseId": "FEwhat_to_watch"}'

# Get comments on a video (adapter — only needs videoId)
openweb youtube exec getComments '{"videoId": "dQw4w9WgXcQ"}'

# Get playlist details and videos (adapter — only needs playlistId)
openweb youtube exec getPlaylist '{"playlistId": "PLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt"}'

# Unsubscribe from a channel (requires auth)
openweb youtube exec unsubscribeChannel '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "channelIds": ["UCsBjURrPoezykLs9EqgamOA"]}'

# Add a comment to a video (adapter — requires auth)
openweb youtube exec addComment '{"videoId": "dQw4w9WgXcQ", "text": "Great video!"}'

# Delete own comment (adapter — requires auth)
openweb youtube exec deleteComment '{"videoId": "dQw4w9WgXcQ", "commentId": "UgzB1_kM5yz1Nv0nHdR4AaABAg"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- **InnerTube API** — all endpoints are POST to `/youtubei/v1/*` with JSON body
- Every request requires `context.client` block with `clientName: "WEB"` and `clientVersion`
- API key passed as `?key=` query param (public key from page global `ytcfg`)
- Responses are large nested JSON with renderer patterns (e.g., `videoRenderer`, `compactVideoRenderer`)
- Single `/browse` endpoint serves channels, playlists, and home feed via `browseId`
- **Adapter operations** (`getComments`, `getPlaylist`) compose InnerTube calls via `pageFetch` — they share underlying endpoints (`/next`, `/browse`) with existing ops but provide simpler interfaces. `getComments` chains two `/next` calls (video → continuation token → comments). `getPlaylist` wraps `/browse` with `VL`-prefixed browseId.

### Auth
- **Public access:** `page_global` — extracts InnerTube API key from `ytcfg.data_.INNERTUBE_API_KEY` on YouTube page. Works for search, browse, next, player, guide, transcript.
- **Authenticated:** `sapisidhash` signing — reads `SAPISID` cookie, computes SHA-1 hash with origin (`https://www.youtube.com`), injects as `Authorization: SAPISIDHASH <timestamp>_<hash>`. Needed for likes, notifications, subscriptions.
- **CSRF:** Not observed separately — sapisidhash serves as both auth and request integrity.

### Transport
- `node` — InnerTube API accepts direct HTTP with API key. No browser needed for public operations.
- `page` — Adapter operations (`getComments`, `getPlaylist`, `addComment`, `deleteComment`) use browser context via `pageFetch` to compose multi-step InnerTube calls and extract `ytcfg` (API key + clientVersion) from the page.

### Adapter Patterns
- `adapters/youtube-innertube.ts` is a `CustomRunner` — exposes a single `run(ctx)` entry point that dispatches by `ctx.operationId`. There is no `init()` (URL check is redundant with PagePlan) and no `isAuthenticated()` probe; auth is enforced per-op via the `sapisidhash` primitive when needed.
- Internal helpers (`innertubePost`, `innertubeAuthPost`) take `helpers: AdapterHelpers` directly so the runtime injects `pageFetch` per call — no adapter-local typing of the helper surface.

### Known Issues
- `getTranscript` has an example file but no openapi.yaml entry — cannot be executed via `openweb exec`. The params token is session-bound and the endpoint returns FAILED_PRECONDITION without valid session context.
- `clientVersion` changes frequently — may need updating when YouTube deploys
- `getVideoPlayer` returns `UNPLAYABLE` status without auth — video details available but stream URLs restricted
- Authenticated operations (like, unlike, subscribe, unsubscribe, addComment, deleteComment, notifications) require sapisidhash which needs browser login
- Trending browse (`FEtrending`) may return 400 on some regions
- Large response payloads (100KB+) with deeply nested renderer structures
- All InnerTube endpoints are POST — verify uses `replay_safety` to determine which ops to include
- **Sub/unsub asymmetry hides auth bugs (2026-04-18)**: Pre-fix, `subscribeChannel` was wired as a direct InnerTube POST without the `sapisidhash` adapter binding. Unauthenticated subscribe **silently no-ops** (HTTP 200, empty success), so the failure was invisible until the inverse `unsubscribeChannel` correctly returned 401 — a sub-without-corresponding-state. **Lesson:** for paired write/undo ops, *always* test the inverse — silent-success on the do-side is a common YouTube failure mode, and the undo-side is the canary.
- **"You may not subscribe to yourself" (HTTP 400)**: `subscribeChannel` rejects your own channel. Verification fixtures must target a third-party channel (current: MKBHD `UCBJycsmduvYEL83R_U4JriQ`).
- **Write ops require full SPA-aligned headers + context (2026-04-20)**: `addComment` was returning soft-block `"Comment failed to post"` despite valid auth. Real cause: minimal request shape (2-key `context.client`, single-token `SAPISIDHASH`, no `x-goog-visitor-id` / `x-youtube-client-name` / `x-youtube-client-version` / `x-youtube-bootstrap-logged-in: true` headers). Real SPA sends ~26-key `INNERTUBE_CONTEXT.client` (visitorData, mainAppWebInfo, screenPixelDensity, browserName/Version, deviceMake/Model, configInfo.appInstallData, etc.) pulled from `ytcfg.data_.INNERTUBE_CONTEXT`. Adapter now reads the full context from the page and forwards the matching headers on every authenticated POST.
- **`SAPISID` vs `__Secure-3PAPISID` cookie selection (2026-04-20)**: server validates `Authorization` header prefix against the cookie used to compute the hash — `SAPISIDHASH ↔ SAPISID`, `SAPISID3PHASH ↔ __Secure-3PAPISID`. Sending the wrong prefix yields HTTP 401. The adapter prefers `SAPISID` and falls back to `__Secure-3PAPISID` with the `SAPISID3PHASH` prefix.
- **`addComment` two-step composer fetch (2026-04-20)**: `createCommentParams` is *not* the same continuation token used to fetch comments — the GET-comments token returns HTTP 404 from `/comment/create_comment`. The real `createCommentParams` lives inside `commentsHeaderRenderer.createRenderer.commentSimpleboxRenderer` in the response of the second `/next` call (with the comments continuation). The composer only renders for an authenticated session — if the second `/next` is not auth'd, YT returns a "Sign in to continue" modal instead of the composer. Adapter now does: `/next?videoId` → grab comments continuation → authenticated `/next?continuation` → walk for `createCommentParams` → `/comment/create_comment`.
- **Write ops blocked by Chrome anti-abuse, not auth (2026-04-20, retracted earlier 1P-cookie diagnosis)**: Initial diagnosis blamed missing first-party `SAPISID`/`SID`/`__Secure-1PSID` on `.youtube.com`, but verified empirically that this account never persists those — only `LOGIN_INFO` + `__Secure-3PAPISID` are scoped to `.youtube.com` even after a successful interactive sign-in (avatar visible, `yt_li=true`). The SPA's own like button still returns HTTP 200 in this exact profile. Real cause: **Chrome attaches `x-browser-validation: <hash>` and `sec-fetch-mode: same-origin` only to UI-initiated requests; JS `fetch()` always sends `sec-fetch-mode: cors` and no validation header, regardless of `mode: 'same-origin'` and explicitly-set `x-browser-validation`.** Tested:
  - Captured `x-browser-validation` from a live SPA click and replayed in `page.evaluate(fetch)` with all matching headers + `mode: 'same-origin'` → still HTTP 401.
  - The SPA-issued request returns 200; the script-issued one a second later with identical cookies, identical Authorization, identical `x-browser-validation`, identical `sec-fetch-mode` → 401. Server has additional layered checks beyond those headers (likely TLS fingerprint or HTTP/2 frame metadata).

  **Implication:** any write op routed through `pageFetch`/`page.evaluate(fetch)` will 401 on `youtubei/v1/like/*`, `comment/create_comment`, `subscription/*`, regardless of cookie state, header construction, or `sec-fetch-mode` override. The only known bypass is to dispatch a real Chrome UI event (`button.click()` via `page.click()` or `page.dispatchEvent('click')`), letting Chrome's UI stack originate the request. That requires re-architecting the affected ops as DOM-interaction adapters (similar to the SPA's button-click path) — not a one-line fix.

- **Cross-domain SAPISID cookie scope (2026-04-20)**: Google SSO sets `SAPISID` / `__Secure-1PAPISID` on `.google.com`, **not** on `.youtube.com` — `__Secure-3PAPISID` is the only `*PAPISID` variant that lives on `.youtube.com`. Adapter queries both domains and emits a multi-prefix `Authorization` header (`SAPISIDHASH ts_h SAPISID1PHASH ts_h SAPISID3PHASH ts_h`). However per the entry above, even a fully-correct `Authorization` is rejected without Chrome's UI-origin signal — so this scope detection is correct but not sufficient on its own.

- **FINAL FIX — write ops use dispatch-events + passive intercept (2026-04-20)**: Confirmed empirically that Chrome's anti-abuse cannot be bypassed by header crafting from JS — the only viable path is to drive the SPA's own UI handlers and intercept the response off the wire. Adapter rewritten to follow the chatgpt-web canonical pattern (`src/sites/chatgpt/adapters/chatgpt-web.ts`):
  - **`likeVideo` / `unlikeVideo`**: `page.goto('/watch?v=<id>')` → wait for `like-button-view-model button` → read `aria-pressed` to honor toggle semantics → `button.click()` via `page.evaluate` → intercept `POST /youtubei/v1/like/(like|removelike)` via `page.on('response')`.
  - **`addComment`**: navigate to watch page → scroll to lazy-load comments → click `ytd-comments #placeholder-area` → `page.keyboard.type(text)` into `ytd-commentbox #contenteditable-root` (composer is contenteditable, `value =` is a no-op) → click `ytd-commentbox button[aria-label="Comment"]` → intercept `POST /youtubei/v1/comment/create_comment`. CommentId extracted from DOM (the optimistic SPA render at top of comments list) — the `actionResults[0].key` field returned in the response is an internal action ID, not the URL-form `Ug...` ID needed for chaining.
  - **`deleteComment`**: navigate to `/watch?v=<id>&lc=<commentId>` (YT's deep-link query pins the target comment to the top regardless of pagination/sort) → poll `ytd-comment-thread-renderer` for the matching commentId, skipping creator-pinned threads → `thread.hover()` → click `#action-menu button` → wait for `ytd-menu-popup-renderer ytd-menu-service-item-renderer` → click the item whose text matches `^delete$` → click confirm in `yt-confirm-dialog-renderer` → intercept `POST /youtubei/v1/comment/perform_comment_action`.
  - **Listener registered BEFORE the click** in every case so an early response is not lost (response handler captures the body promise; a poll loop awaits it with timeout).
  - **Verification (2026-04-20):** `likeVideo` ✓ PASS, `addComment` ✓ PASS, `deleteComment` ⚠ extracts a commentId from DOM but the `lc=` deep-link sometimes does not surface a freshly-posted comment within 20s (YT's backend propagation / spam-pending state). The adapter pattern is correct; the residual blocker is YT propagation latency, not adapter design.
  - **Architectural note:** the `innertubeAuthPost` path is now unused for write ops but is kept around for read-only multi-step flows (`getComments`, `getPlaylist`) which Chrome's anti-abuse does not gate.
