# Reddit — 7 new write/read ops

## What was done
Added 6 write ops and 1 read op to the Reddit site package: `createPost`, `createComment`, `deleteThing`, `subscribe`, `unsavePost`, `blockUser`, `getNotifications`. Total ops: 10 → 17.

## Approach
- All new ops use `oauth.reddit.com` server override (operation-level `servers` block)
- Write ops: `permission: write`, `safety: caution`; getNotifications: `permission: read`
- Node transport inherited from global server config
- `deleteThing` is a single op covering both post and comment deletion (Reddit uses same `/api/del` endpoint)
- `subscribe` handles both sub and unsub via `action` field enum
- Request bodies use `application/json` per spec convention

## Files changed
- `openapi.yaml` — 7 new paths/operations (stable_ids `rd0011`–`rd0017`)
- `examples/` — 7 new example JSON files (6 with `replay_safety: unsafe_mutation`, 1 read)
- `DOC.md` — new workflows (create content, manage content, community, notifications), expanded ops table, quick start
- `manifest.json` — unchanged (requires_auth stays false since public reads work without auth)

## Pitfalls
- Reddit API traditionally uses `application/x-www-form-urlencoded` — JSON requestBody may need an adapter for form encoding at runtime
- `blockUser` requires `account_id` (t2_xxx fullname), not username — callers must resolve via `getUserProfile` first
- `deleteThing` only works on content owned by the authenticated user
- `subscribe` with `action: unsub` is a write operation despite being a "removal"

## Verification
- `pnpm build`: compiles without errors
- `pnpm dev verify reddit --write --browser`: read ops pass on public API; write ops gated behind auth
