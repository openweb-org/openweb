# AngelList Venture — Progress

## 2026-04-23: Initial site package (v1)

### Context
Built AngelList Venture (venture.angellist.com) site package from scratch. Investor-side dashboard with 6 read-only operations across 3 families: invites, messages, posts.

### Changes
- Created adapter-only site package (no compile step — all ops via GraphQL adapter)
- 6 operations: listInvites, getInvite, listMessages, getMessage, listPosts, getPost
- Venture ops use Apollo client.query() via CDP main-world evaluation (x-al-gql signing)
- getInvite uses response intercept pattern for portal.angellist.com cross-origin data room

### Verification
- listInvites: 122 invites returned
- listMessages: paginated threads with participants
- getMessage(419088): full thread with messages
- listPosts: paginated syndicate posts
- getPost(89544): full post body
- getInvite(17646): fund-type data room (SaxeCap Fund I / SCVC) — 4 sections

### Key Discoveries
- patchright page.evaluate runs in isolated world — must use CDPSession for main-world access
- x-al-gql is a per-request signing header computed by Apollo's link chain
- Dynamic import of graphql parser from esm.sh CDN enables DocumentNode creation
- ConversationQuery messages() field requires redundant conversationId/userSlug args
- Fund vs company deal invites may have different data room structures (TBD)

## 2026-04-25: Userflow QA — auth hardening + verify scaffolding

### Context
Attempted 3 blind persona workflows (due diligence researcher, message triage, syndicate update reader) but blocked by expired session cookies — venture.angellist.com requires authenticated login and the prior session from 2026-04-23 has expired. Site has reCAPTCHA on login, preventing automated re-auth.

### Workflows Designed (not executed)
1. **Due Diligence Researcher**: listInvites → pick canInvest=true deal → getInvite(virtualDealId) for data room
2. **Message Triage**: listMessages(limit=5) → pick first conversation → getMessage(conversationId)
3. **Syndicate Update Reader**: listPosts(limit=5) → pick first post → getPost(postId)

### Gaps Found
| Gap | Type | Fix |
|-----|------|-----|
| `ERR_TOO_MANY_REDIRECTS` crash when not logged in | Auth error handling | Catch redirect loop → `needsLogin()` |
| `__APOLLO_CLIENT__` timeout when not logged in | Auth error handling | Catch `waitForFunction` timeout → `needsLogin()` |
| `page.goto` timeout on unauthenticated navigate | Auth error handling | Catch Timeout in `ensureVenturePage` → `needsLogin()` |
| `openweb login angellist` fails: no `site_url` in manifest | Missing field | Added `site_url` to manifest.json |
| Verify shows 0/0 ops — no example files | Missing scaffolding | Created 6 example files |
| `resolveViewer` threw raw Error instead of structured error | Error consistency | Changed to `helpers.errors.needsLogin()` |
| Dead code: `Q_DATAROOM` constant unused | Cleanup | Removed (data room uses response intercept) |

### Changes
- **adapter**: `ensureVenturePage` now catches `ERR_TOO_MANY_REDIRECTS`, navigation `Timeout`, and login page redirect — all throw `helpers.errors.needsLogin()` for proper structured error reporting
- **adapter**: Plumbed `AdapterHelpers` through all internal functions (`ventureGql`, `resolveViewer`, all op handlers) for consistent error reporting
- **adapter**: Reduced navigation timeout from 25s → 15s for faster auth failure detection
- **adapter**: Removed unused `Q_DATAROOM` GraphQL constant
- **manifest**: Added `site_url: "https://venture.angellist.com"` to enable `openweb login angellist`
- **examples**: Created 6 example files for verify (listInvites, getInvite, listMessages, getMessage, listPosts, getPost)

### Verify Results (auth expired)
Before fixes: `0/0 ops` (no examples), crashes with `ERR_TOO_MANY_REDIRECTS`
After fixes: `0/6 ops` — 4 properly report `authentication expired (401/403)`, 1 op timeout, 1 data room intercept miss. All auth-related. No code bugs.

### Blocker
Session expired + reCAPTCHA on login page. Cannot re-authenticate in headless env. Response size QA (bloat trimming) deferred until session is restored. To unblock: `openweb login angellist` from a machine with a display.
