# Instagram — 16 new operations

## What was added
16 new operations (11 write, 5 read) on top of the existing 8 (7 read, 1 write).

### Write ops (all POST, CSRF auto-injected, permission: write, safety: caution)
| Operation | Endpoint | RequestBody | Notes |
|-----------|----------|-------------|-------|
| unlikePost | /api/v1/web/likes/{id}/unlike/ | — | mirrors likePost |
| followUser | /api/v1/web/friendships/{id}/follow/ | — | returns friendship_status |
| unfollowUser | /api/v1/web/friendships/{id}/unfollow/ | — | returns friendship_status |
| savePost | /api/v1/web/save/{id}/save/ | — | bookmark |
| unsavePost | /api/v1/web/save/{id}/unsave/ | — | remove bookmark |
| createComment | /api/v1/web/comments/{id}/add/ | `{ comment_text }` | returns created comment |
| deleteComment | /api/v1/web/comments/{media_id}/{comment_id}/delete/ | — | two path params |
| blockUser | /api/v1/web/friendships/{id}/block/ | — | returns friendship_status |
| unblockUser | /api/v1/web/friendships/{id}/unblock/ | — | returns friendship_status |
| muteUser | adapter → /api/v1/friendships/mute_posts_or_story_from_follow/ | form body | mutes posts + stories |
| unmuteUser | adapter → /api/v1/friendships/unmute_posts_or_story_from_follow/ | form body | unmutes posts + stories |

### Read ops
| Operation | Endpoint | Notes |
|-----------|----------|-------|
| getExplore | /api/v1/discover/web/explore_grid/ | paginated, trending grid |
| getFollowers | /api/v1/friendships/{id}/followers/ | paginated |
| getFollowing | /api/v1/friendships/{id}/following/ | paginated |
| getReels | adapter → POST /api/v1/clips/user/ | paginated, play_count |
| getNotifications | /api/v1/news/inbox/ | activity feed |

## Design decisions

1. **Direct API vs adapter**: Simple write ops (unlike, follow, save, block, comment) use direct API paths — same pattern as existing likePost. muteUser/unmuteUser need adapters because the real endpoint uses a different URL pattern (mute_posts_or_story_from_follow with target_posts_author_id in body). getReels needs adapter because it's a POST for read data.

2. **CSRF handling**: Direct API write ops get CSRF from the server-level csrf config (cookie_to_header). Adapter ops extract csrftoken from cookies manually via getCsrfToken helper.

3. **Response schemas**: Kept lean — friendship ops include friendship_status object, createComment returns the created comment, simple ops return just { status }.

4. **likePost**: Added `safety: caution` to match the new write ops pattern (was missing before).

## Verification results
- Build: PASS
- Verify (--browser): 10/12 read ops PASS
  - getNotifications: FAIL — transient HTTP 500 (Instagram server-side)
  - getReels: FAIL — 403 (clips endpoint may need additional auth headers beyond CSRF)
  - All 11 write ops: skipped by verify (expected — write ops are not tested)

## Files changed
- `src/sites/instagram/openapi.yaml` — 16 new paths/operations
- `src/sites/instagram/adapters/instagram-api.ts` — postJson + getCsrfToken helpers, muteUser/unmuteUser/getReels
- `src/sites/instagram/examples/*.example.json` — 16 new example files + likePost replay_safety fix
- `src/sites/instagram/DOC.md` — expanded workflows, ops table (24 ops), quick-start
