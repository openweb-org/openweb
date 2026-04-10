# Bluesky — 13 new write/read ops

## What was done
Added 12 write ops and 1 read op to the Bluesky site package: `createPost`, `deletePost`, `likePost`, `unlikePost`, `repost`, `unrepost`, `follow`, `unfollow`, `blockUser`, `unblockUser`, `muteUser`, `unmuteUser`, `getNotifications`. Total ops: 9 → 22.

## Approach
- All new ops route through the `bluesky-pds` adapter — the adapter reads the user's PDS URL and JWT from `localStorage` (`BSKY_STORAGE`)
- Record-based ops (post, like, repost, follow, block) use `com.atproto.repo.createRecord` / `deleteRecord` via the PDS
- Mute/unmute use dedicated XRPC procedures (`app.bsky.graph.muteActor` / `unmuteActor`)
- `getNotifications` uses `app.bsky.notification.listNotifications` on the user's PDS
- Each write op has `permission: write`, `safety: caution`; getNotifications has `permission: read`
- Server override to `bsky.app` with `page` transport for all adapter ops (browser needed for localStorage)
- Adapter refactored: extracted `pdsGet`/`pdsPost`, `requireSession`, `createRecord`/`deleteRecord` helpers

## Files changed
- `openapi.yaml` — 13 new paths/operations (stable_ids `bsky_*_v1`)
- `adapters/bluesky-pds.ts` — rewritten with POST support and 13 new operation handlers
- `examples/` — 13 new example JSON files (12 with `replay_safety: unsafe_mutation`, 1 `safe_read`)
- `manifest.json` — requires_browser/login set to true
- `DOC.md` — new workflows, expanded ops table, quick start, known issues

## Pitfalls
- AT Protocol uses the same `createRecord`/`deleteRecord` endpoints for all record types — the `collection` field differentiates them
- Reverse ops (`unlikePost`, `unrepost`, `unfollow`, `unblockUser`) require the AT URI of the record to delete, not the original post/user URI — this comes from the `viewer.*` fields in authenticated responses
- Reply threading requires both parent and root refs — the adapter defaults root to parent for top-level replies; threaded replies need explicit `rootUri`/`rootCid`
- The user's DID is extracted from the session for the `repo` field in `createRecord`/`deleteRecord`

## Verification
- `pnpm build`: compiles without errors
- `pnpm dev verify bluesky --write --browser`: read ops pass on public API; write ops gated behind auth/permission layer
