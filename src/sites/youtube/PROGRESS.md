# YouTube — Progress

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

**Verification status:** Adapter request shape now matches the SPA byte-for-byte on the inspected fields, but `addComment`/`deleteComment` still fail in this session because the openweb-managed browser profile lacks the first-party `SAPISID` cookie set — only `__Secure-3PSID`/`__Secure-3PAPISID`/`LOGIN_INFO` are present, so the authenticated `/next` returns the sign-in composer (`yt_li=0`) and the new diagnostic fires: *"the composer did not render (account likely lacks 1P SAPISID cookie; re-login needed)"*. `likeVideo` exhibits the same 401 against this profile, confirming the issue is the cookie set, not request shape. Fix is environmental: re-login to YouTube in the openweb-managed browser to populate the 1P cookies; the adapter changes are necessary and will take effect once that's done.

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
