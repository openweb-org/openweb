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
