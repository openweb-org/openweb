# AngelList Venture — Internal

## Overview
AngelList Venture investor-side surface. Three read-only families: invites, messages, posts. Logged-in only.

## Auth
- Session cookie from default Chrome profile (cookie_session).
- `x-al-gql` signing header — per-request hash computed by Apollo's link chain middleware. Rotates with query string. Cannot replay from Node; must use Apollo client.query() in main-world page context.
- Portal (portal.angellist.com) uses separate cookies, no signing header. Raw fetch works on portal.

## Transport
- **Venture ops** (listInvites, listMessages, getMessage, listPosts, getPost): Apollo client.query() via CDP Runtime.evaluate in main world. Patchright page.evaluate runs in isolated world and cannot access window.__APOLLO_CLIENT__. CDPSession.send('Runtime.evaluate') is the workaround.
- **getInvite**: Response intercept pattern. Navigate to portal invest URL, capture MemberDataRoom GraphQL response from portal's own page load. Similar to JD intercept pattern.

## Probe Results

| Family | Evidence | Transport | Auth/CSRF | Lane | Notes |
|---|---|---|---|---|---|
| invites | GraphQL (CurrentDealInvitesQuery) | page (Apollo main-world) | cookie + x-al-gql | adapter | ViewerQuery auto-resolves userId/investAccountId |
| invite detail | GraphQL (MemberDataRoom) on portal | page (intercept) | portal cookie | adapter/intercept | Cross-origin; fund vs deal types may differ |
| messages | GraphQL (ConversationsQuery, ConversationQuery) | page (Apollo main-world) | cookie + x-al-gql | adapter | messages() field needs its own conversationId arg |
| posts | GraphQL (InvestPostsQuery, InvestPostQuery) | page (Apollo main-world) | cookie + x-al-gql | adapter | Simplest family |

## Key Discoveries
1. patchright page.evaluate uses isolated execution world — window globals from page JS not visible.
2. x-al-gql is computed per-request by Apollo link chain; 403 without it.
3. Dynamic import of graphql parser from esm.sh CDN works in main world to create DocumentNode for Apollo.
4. ConversationQuery's messages() field has redundant userSlug/conversationId args that must be provided.
5. Fund-type invites vs direct-deal invites may have different portal data room layouts.
