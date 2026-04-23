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
