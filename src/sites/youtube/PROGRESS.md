# YouTube — Progress

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
