# AngelList Venture

## Overview
AngelList Venture (`venture.angellist.com`) — investor-side dashboard for syndicates, deals, and LP messaging. Logged-in only. Read-only coverage.

## Workflows

### Review pending deal invites
1. `listInvites` → all current invites with deal id, name, syndicate, status
2. `getInvite(virtualDealId)` → data room: memo, deck, slides, attachments (via portal.angellist.com)

### Read inbox messages
1. `listMessages` → paginated message threads with participants, last message, unread status
2. `getMessage(conversationId)` → full thread with all messages

### Read syndicate posts
1. `listPosts` → paginated syndicate posts with title, author, date
2. `getPost(postId)` → full post body, syndicate, documents

## Operations

| Operation | Intent | Key Input | Key Output | Transport |
|-----------|--------|-----------|------------|-----------|
| listInvites | current deal pipeline | — | id, dealName, virtualDealId, syndicateName, canInvest, investUrl | adapter (page, Apollo) |
| getInvite | deal data room | virtualDealId ← listInvites | senderOrgHandle, sections[].header, sections[].content, sections[].files[] | adapter (page, intercept portal) |
| listMessages | inbox threads | limit?, cursor? | conversations[].id, participants, lastMessage, isUnread | adapter (page, Apollo) |
| getMessage | thread messages | conversationId ← listMessages | participants, messages[].text, messages[].sentAt, messages[].sentBy | adapter (page, Apollo) |
| listPosts | syndicate posts | limit?, cursor? | posts[].id, title, fromName, publishAt, isUnread | adapter (page, Apollo) |
| getPost | full post | postId ← listPosts | title, body, fromName, syndicateName, documents | adapter (page, Apollo) |

## Known Limitations
- Logged-in only; session cookies from default Chrome profile.
- `getInvite` navigates to portal.angellist.com (cross-origin); fund-type and deal-type invites may have different data room layouts.
- `x-al-gql` signing header requires Apollo client.query() via main-world CDP — patchright's isolated evaluate cannot access `__APOLLO_CLIENT__`.
- GraphQL `messages` resolver requires `conversationId` passed directly to the `messages()` field, not just the parent `conversation()`.
