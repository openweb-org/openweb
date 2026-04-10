# Hacker News — 2 new write operations

## What was added
2 write operations on top of the existing 14 read-only ops.

### Write ops (permission: write, safety: caution)
| Operation | Mechanism | RequestBody | Notes |
|-----------|-----------|-------------|-------|
| upvoteStory | GET vote link via page.evaluate fetch | `{ id }` | extracts auth token from page vote link href |
| addComment | POST form via page.evaluate fetch | `{ parent, text }` | extracts HMAC from comment form |

## Design decisions

1. **Form-based submission**: HN has no JSON API. Upvote works by following the vote link (`/vote?id=X&how=up&auth=TOKEN`) which is embedded in the page DOM. Comment submission POSTs to `/comment` with form-encoded body including an HMAC token extracted from the hidden form field.

2. **Auth via cookie session**: Both write ops require the user to be logged into HN in the browser. The adapter navigates to the item page, extracts the auth/HMAC tokens from the DOM, then issues fetch requests within the page context (credentials: include).

3. **No CSRF header needed**: HN uses per-link auth tokens (upvote) and per-form HMAC tokens (comment) instead of cookie-based CSRF. These are extracted from the DOM at call time.

## Verification results
- Build: PASS
- Verify (--browser): 10/10 read ops PASS
- Write ops: skipped by verify (expected — unsafe_mutation)

## Files changed
- `src/sites/hackernews/openapi.yaml` — 2 new paths (upvoteStory, addComment)
- `src/sites/hackernews/adapters/hackernews.ts` — upvoteStory + addComment functions
- `src/sites/hackernews/examples/upvote_story.example.json` — replay_safety: unsafe_mutation
- `src/sites/hackernews/examples/add_comment.example.json` — replay_safety: unsafe_mutation
- `src/sites/hackernews/manifest.json` — operation_count 14 → 16
- `src/sites/hackernews/DOC.md` — new workflows, ops table rows, quick-start examples
