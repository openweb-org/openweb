# YouTube — Progress

## 2026-04-20 — Write ops rewritten: dispatch-events + passive intercept (Stage 5h, FINAL)

**Context:** All prior request-shape fixes (Stages 5d/5g) brought the JS-fetched request byte-for-byte close to the SPA's, but Chrome's anti-abuse layer still 401'd `like/like`, `comment/create_comment`, `subscription/*`. Empirically reproduced: even capturing a live `x-browser-validation` token from a SPA-clicked request and replaying it via `page.evaluate(fetch)` with identical cookies, identical Authorization, identical `sec-fetch-mode: same-origin` returns 401 a second later — so the gating signal is not in any header we can read or set from JS (likely TLS fingerprint or HTTP/2 frame metadata bound to the UI-stack request origin).

**Fix:** Rewrote `likeVideo`, `unlikeVideo`, `addComment`, `deleteComment` to follow the **dispatch-events + passive intercept** pattern documented in `skill/openweb/knowledge/bot-detection.md` § Dispatch-Events Pattern, modeled directly on `src/sites/chatgpt/adapters/chatgpt-web.ts` (which solves the same class of problem for chatgpt's Sentinel + PoW).

- Listener registered via `page.on('response', …)` **before** any click, so early responses are not lost.
- The actual click is dispatched as a real Chrome UI event (`button.click()` from `page.evaluate`, `page.click()`, or `page.keyboard.type` for the contenteditable composer).
- Each handler awaits the intercepted body promise with a 15–20s timeout.

**Op-by-op:**
- `likeVideo` / `unlikeVideo`: navigate to watch page → wait for `like-button-view-model button` → read `aria-pressed` (toggle semantics — if already in desired state, return `noop: true`) → JS click → intercept `/like/(like|removelike)`.
- `addComment`: navigate → scroll-into-view to lazy-load comments → click placeholder → focus contenteditable + `keyboard.type(text)` → click Comment button → intercept `/comment/create_comment`. The returned `actionResults[0].key` is an internal action ID, **not** the URL-form `Ug…` ID — so commentId is read from the SPA's optimistic DOM render at the top of the comments list (matched by author content text). Falls back to deep-search on the response body if DOM hasn't rendered within 10s.
- `deleteComment`: navigate to `https://www.youtube.com/watch?v=<id>&lc=<commentId>` (YT's `lc=` deep-link pins the target comment to the top regardless of pagination/sort) → poll `ytd-comment-thread-renderer` for the matching commentId, **filtering out creator-pinned threads** (which carry the `pinned` attribute on `ytd-comment-view-model` and are always rendered at index 0) → hover thread → click kebab `#action-menu button` → wait for `ytd-menu-popup-renderer ytd-menu-service-item-renderer` → click item whose text matches `/^delete$/i` → click confirm in `yt-confirm-dialog-renderer #confirm-button button` → intercept `/comment/perform_comment_action`.

**Fixture fix (`src/sites/youtube/examples/deleteComment.example.json`):** `videoId` was hardcoded to `jNQXAC9IVRw` while `commentId` chained `${prev.addComment.commentId}` (which targets `KDmbehLBphg`). Verify navigated to the wrong video and could never find the comment. Now: `videoId: "${prev.addComment.videoId}"`.

**Verification (`pnpm dev verify youtube --browser --write --ops likeVideo,addComment,deleteComment`):**
- ✓ `likeVideo`: PASS
- ✓ `addComment`: PASS
- ⚠ `deleteComment`: pattern works (kebab → menu → delete → confirm flow exercised correctly), residual blocker is **YT spam-filter shadowban**, confirmed via live probe (commit `f920599`):
  - `addComment` returns HTTP 200 + a `commentId`, but the comment never appears in the public comments thread on the video page.
  - `lc=<freshCommentId>` deep-link returns the regular page title ("Coding Vlog Ep. 6 - Deploying a New Feature - YouTube") instead of "Comment from @imooooonkey…" — YT's URL handler doesn't recognize the freshly-posted ID at all.
  - DOM scan after navigation shows zero `@imooooonkey` comments among the rendered threads; older `@imooooonkey` comments from prior runs that *did* survive the filter (`UgwVTfLIp_qKWKUc3k94AaABAg`) DO surface via `lc=` and DO have the canonical anchor — proving the deleteComment UI flow works on visible comments.
  - This is the same diagnosis originally proposed in `doc/todo/write-verify/handoff5.md` §3.1 (and twice retracted in favor of request-shape / cookie-scope hypotheses, both wrong). Probe-confirmed this round.
- **Recovery path** (out of adapter scope): use a YouTube account whose comments aren't spam-filtered, or wait for the filter to relax (typically days–weeks).

**Architectural decision:** Read-only multi-step ops (`getComments`, `getPlaylist`) keep using `innertubeAuthPost` / `pageFetch` — Chrome's anti-abuse does not gate those. Only mutation ops require the dispatch-events path.

**Pattern lesson:** When `page.evaluate(fetch)` returns 401/403 with byte-identical headers + cookies as the SPA, the gating signal lives below the headers (TLS, HTTP/2, request-origin hooks) — stop trying to spoof the wire and instead drive the SPA's own UI handlers. The chatgpt-web pattern generalizes: **focus a real DOM target, dispatch real events, intercept the resulting wire response.** Don't re-implement the gate; let the page do it.

---

## 2026-04-20 — `addComment` / `deleteComment` Request Shape Fix (Stage 5d)

**Context:** Both ops failed against a logged-in account that *can* post comments manually in default Chrome. Prior handoff (`handoff5.md` §3) misdiagnosed it as account shadowban / quota — same misdiagnosis pattern as walmart (`46dd46e`) and spotify (`a1831bb`).

**Real cause (three layers):**
1. **Minimal context + missing headers.** The adapter sent `context = {client: {clientName, clientVersion}}` (2 keys) and only `authorization`/`x-goog-authuser`/`x-origin` headers. Real SPA sends ~26-key `INNERTUBE_CONTEXT.client` (visitorData, mainAppWebInfo, configInfo.appInstallData, deviceMake, browserName/Version, screenPixelDensity, platform, etc.) plus `x-goog-visitor-id`, `x-youtube-client-name`, `x-youtube-client-version`, `x-youtube-bootstrap-logged-in: true`. With the impoverished shape, YT's spam filter returned `showErrorAction: "Comment failed to post."` (HTTP 200 + soft block).
2. **Wrong `createCommentParams` token.** The adapter was passing the GET-comments continuation token to `/comment/create_comment` — that returns HTTP 404 "Requested entity was not found". The actual `createCommentParams` lives inside `commentsHeaderRenderer.createRenderer.commentSimpleboxRenderer` of the *second* `/next` response (the one that fetches the comments). That second `/next` must be authenticated, otherwise YT renders a sign-in modal in place of the composer.
3. **Wrong SAPISIDHASH prefix for cookie set.** The adapter only computed `SAPISIDHASH` from `SAPISID`. Many sessions only have `__Secure-3PAPISID` (no first-party `SAPISID`); the matching prefix is `SAPISID3PHASH`. Sending `SAPISIDHASH` with a 3P cookie value yields HTTP 401.

**Changes (`src/sites/youtube/adapters/youtube-innertube.ts`):**
- `getYtConfig` now also returns `INNERTUBE_CONTEXT`, `VISITOR_DATA`, `INNERTUBE_CONTEXT_CLIENT_NAME` from `ytcfg.data_`.
- `makeContext(config)` returns the full ytcfg context when available; falls back to the 2-key minimal context only if ytcfg is missing.
- `innertubePost` / `innertubeAuthPost` add `x-youtube-client-name`, `x-youtube-client-version`, `x-goog-visitor-id`, and (auth path) `x-youtube-bootstrap-logged-in: true`.
- `getSapisidAuth` prefers `SAPISID` (`SAPISIDHASH` prefix) and falls back to `__Secure-3PAPISID` (`SAPISID3PHASH` prefix). Hash format includes the `_u` user suffix the SPA uses.
- `addComment` and `deleteComment` now navigate to `/watch?v=<id>` first so `ytcfg` is the watch-page context, then `addComment` does the two-step composer fetch (`/next?videoId` → comments continuation → authenticated `/next?continuation` → walk for `createCommentParams` → `/comment/create_comment`).

**Verification status (RETRACTED 1P-cookie diagnosis, 2026-04-20):** Earlier note blamed missing first-party `.youtube.com|SAPISID/SID/__Secure-1PSID` cookies. Verified empirically that this account never persists those cookies on `.youtube.com` — only `LOGIN_INFO + __Secure-3PAPISID` ever appear, even after a fully-interactive YouTube sign-in (avatar visible, `yt_li=true`). Real cause of `likeVideo`/`addComment` 401s: **Chrome-stack anti-abuse on YouTube's write APIs.** The SPA's own button click returns HTTP 200 in this profile; an immediate `page.evaluate(fetch)` with identical cookies, identical Authorization, captured `x-browser-validation`, and `mode: 'same-origin'` returns 401. Chrome attaches `x-browser-validation` and `sec-fetch-mode: same-origin` only to UI-originated requests, and there are additional layered checks beyond those headers (likely TLS fingerprint or HTTP/2 metadata). **Implication:** every InnerTube write op routed through `pageFetch`/`page.evaluate(fetch)` will 401 regardless of cookie state or header construction. Bypass would require dispatching real Chrome UI events (`button.click()` via `page.click()`) so Chrome's UI stack originates the request — i.e., re-architecting affected ops as DOM-interaction adapters. See DOC.md "Write ops blocked by Chrome anti-abuse, not auth" for the full investigation.

**Handoff5 §3.1 retraction:** the original "Comment failed to post" was *not* an account shadowban / soft-block from posting frequency. Root cause was request shape (impoverished `context.client`, wrong continuation token used as `createCommentParams`, missing SPA headers). Pattern matches walmart/spotify: server-side soft-rejects of openweb's request that look like account problems but are actually divergence from the real SPA shape.

---

## 2026-04-18 — Write-Verify Campaign

**Context:** First end-to-end exercise of write ops via `pnpm dev verify youtube --write`.
**Changes (`8cfebff`):**
- Routed `subscribeChannel` and `unsubscribeChannel` through the `youtube-innertube` adapter so both pick up `sapisidhash` signing. Pre-fix, `subscribeChannel` was a direct InnerTube POST missing the auth binding — it silently 200-no-op'd while `unsubscribeChannel` (correctly 401'd) exposed the asymmetry.
- Switched verification fixture to MKBHD channel `UCBJycsmduvYEL83R_U4JriQ` (cannot subscribe to own channel — YouTube returns "you may not subscribe to yourself" HTTP 400).

**Verification:** 4/4 write ops PASS (`subscribeChannel`, `unsubscribeChannel`, `likeVideo`, `unlikeVideo`).
**Key discovery:** Silent-success on the do-side of a write/undo pair is a recurring YouTube failure mode. The undo-side is the canary — its 401 is what unmasks an unauthenticated do-side. Pair-test write ops always.
**Pitfalls encountered:** "Verify the create succeeded" using a 200 status alone is misleading on InnerTube — it returns 200 with no body content even when no state changed. Inverse-op test is the only reliable signal.

---

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate `youtube-innertube` adapter from the legacy `CodeAdapter` shape to the unified `CustomRunner` interface so all site adapters share one entry point.
**Changes:**
- `src/sites/youtube/adapters/youtube-innertube.ts` converted from `CodeAdapter` to `CustomRunner` with a single `run(ctx)` dispatch (575 → 525 lines, commit 10db539).
- Dropped `init()` (URL check was redundant with PagePlan) and `isAuthenticated()` (returned `true` — no real probe).
- Refactored `innertubePost` / `innertubeAuthPost` to receive `helpers` directly; replaced local `Errors` / `PageFetchFn` types with shared `AdapterHelpers`.
- 7 ops preserved byte-for-byte: `getComments`, `getPlaylist`, `addComment`, `deleteComment`, `getTranscript`, `likeVideo`, `unlikeVideo`.

**Verification:** 12/12 ops PASS.
**Key files:** `src/sites/youtube/adapters/youtube-innertube.ts`, `src/sites/youtube/DOC.md`.

---

## 2026-04-13: Verify fix — auth + getTranscript

**What changed:**
- Fixed likeVideo/unlikeVideo auth: simplified example params (removed redundant key/context fields)
- Switched getTranscript from innertube /get_transcript to timedtext API with browser auth context
- Updated examples for likeVideo, unlikeVideo, getTranscript

**Why:** likeVideo/unlikeVideo failed with 401 (stale example format). getTranscript returned 400 FAILED_PRECONDITION because /get_transcript needs authenticated session.

---

## 2026-04-11 — Discovery & Implementation

## What was added
3 new write/reverse operations for YouTube InnerTube API:

1. **unsubscribeChannel** (yt0013) — direct InnerTube POST to `/subscription/unsubscribe`. Mirrors the existing `subscribeChannel` op. Takes `channelIds` array, same as subscribe.

2. **addComment** (yt0014) — adapter operation via `youtube-innertube`. Two-step: fetches `/next` to get the comment creation params token (same continuation extraction as `getComments`), then POSTs to `/comment/create_comment` with the token and comment text. Returns `commentId` for use with `deleteComment`.

3. **deleteComment** (yt0015) — adapter operation via `youtube-innertube`. POSTs to `/comment/perform_comment_action` with `action_remove_comment` and the `commentId`. Reverses `addComment`.

## Design decisions

- **unsubscribeChannel as direct InnerTube call**: Same structure as `subscribeChannel` — no adapter needed. Just a different endpoint path.
- **addComment/deleteComment as adapter ops**: These require browser context for two reasons: (1) extracting `createCommentParams` from the video page (same continuation-token pattern as `getComments`), and (2) sapisidhash auth needs cookies from a logged-in session. The adapter's `pageFetch` handles both.
- **Comment creation token reuse**: `addComment` reuses the same continuation-token extraction logic from `getComments` — the comment section continuation also serves as the `createCommentParams` for posting.
- **`replay_safety: unsafe_mutation`** on all 3 examples: These are genuine mutations (unsubscribing, posting/deleting comments) that shouldn't be replayed during verify.
- **`safety: caution`** on all 3 ops: Standard for write operations — runtime prompts before execution.

## Pitfalls

- `createCommentParams` token is session-bound — won't work without valid browser session context (sapisidhash cookies)
- `deleteComment` can only delete comments authored by the authenticated user
- InnerTube `perform_comment_action` endpoint uses an opaque action encoding; the adapter passes `action_remove_comment` + `commentId` which is the documented approach but YouTube may change the proto format
- All 3 ops require browser login (sapisidhash) — they'll fail on unauthenticated sessions

## Verification
- `pnpm build` — clean
- `pnpm dev verify youtube --browser` — 8/12 read ops PASS, write ops correctly skipped (need `--allow-write`), new ops excluded via `unsafe_mutation` replay safety
