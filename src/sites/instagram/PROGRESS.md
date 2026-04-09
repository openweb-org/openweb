## 2026-04-09: Polish instagram site package (enhanced 4→8 ops)

**What changed:**
- Fixed DOC.md heading levels (Site Internals subsections now `###`)
- Added `required` arrays to all new op response schemas (getUserPosts, getPostComments, getStories)
- Added `description` to all nested objects and properties across 4 new op schemas
- Added `required` arrays on nested items (comment, story item, image rendition, user)
- Created `likePost.example.json` (write op, `unsafe_write` replay safety)
- Added description to likePost status field

**Why:**
- Quality checklist: no bare properties without descriptions, required where data always present, complete examples

**Key files:**
- `openapi.yaml` — schema hardening on getUserPosts, getPostComments, getStories, likePost
- `DOC.md` — heading level fix
- `examples/likePost.example.json` — new

**Verification:** pnpm build, pnpm dev verify instagram

## 2026-04-02: Initial discovery — 4 operations

**What changed:**
- Discovered Instagram REST API v1 endpoints via browser capture
- Compiled: getUserProfile, getPost, getFeed, searchUsers
- Configured page transport (Meta bot detection blocks node)
- Set cookie_session auth with csrftoken CSRF

**Why:**
- Net-new site package for Instagram
- REST v1 endpoints chosen over GraphQL for stability (doc_id hashes change)

**Verification:** compile-time verify shows auth_drift (expected without live browser)
