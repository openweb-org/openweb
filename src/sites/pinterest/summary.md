# Pinterest Write Ops — Summary

## What was added

| New Op | Type | API Endpoint | Method | Key Params |
|--------|------|-------------|--------|-----------|
| savePin | write (reverse: unsavePin) | `/resource/RepinResource/create/` | POST | pin_id, board_id, section_id? |
| unsavePin | write (reverse of savePin) | `/resource/SavePinResource/delete/` | POST | pin_id, board_id |
| followBoard | write (reverse: unfollowBoard) | `/resource/BoardFollowResource/create/` | POST | board_id |
| unfollowBoard | write (reverse of followBoard) | `/resource/BoardFollowResource/delete/` | POST | board_id |
| getHomeFeed | read | `/resource/UserHomefeedResource/get/` | GET | field_set_key, page_size |
| getNotifications | read | `/resource/NewsHubResource/get/` | GET | field_set_key, page_size |

## Files changed

- `openapi.yaml` — 6 new paths (total: 11 ops, 5 existing read + 4 write + 2 new read)
- `examples/*.example.json` — 6 new example files (4 with `unsafe_mutation`, 2 `safe_read`)
- `DOC.md` — expanded workflows (save/organize, follow/unfollow, home feed/notifications), ops table, quick-start, internals
- `PROGRESS.md` — new entry for this sprint

## Patterns discovered

- **Pinterest resource API pattern for writes**: POST to `/resource/{ResourceName}/create/` or `/resource/{ResourceName}/delete/` with form-encoded `source_url` and `data` body fields. Same `{"options":{...},"context":{}}` structure as read ops.
- **Reverse ops use different resources**: Unlike TikTok (same endpoint, different param), Pinterest uses `RepinResource/create/` for save and `SavePinResource/delete/` for unsave. Similarly, `BoardFollowResource/create/` and `BoardFollowResource/delete/`.
- **CSRF required for writes**: POST requests need `x-csrftoken` header (auto-injected from `csrftoken` cookie by the runtime's CSRF handler).
- **Home feed is personalized**: `UserHomefeedResource` returns pins tailored to the logged-in user's interests, similar to the main pinterest.com page.

## Bot detection notes

Pinterest has aggressive bot detection:
- **page transport required**: All requests (read and write) must go through browser context — direct HTTP returns 403.
- **Pinterest-specific headers**: `x-requested-with: XMLHttpRequest`, `x-pinterest-appstate: active` are required on all API calls.
- **Write ops best-effort**: Write operations depend on valid session cookies and CSRF tokens. If session is stale, writes fail silently (HTTP 200 with error in response body).

## Verification

- `pnpm build` — PASS
- `pnpm dev verify pinterest --browser` — PASS (7/7 read ops; 4 write ops skipped as unsafe_mutation)
