# Social, Messaging & Content

> Archetypes are heuristic starting points, not limiting checklists.

User-facing sites focused on content consumption, social interaction, and communication.

- **Social Media** — feed-based, user-generated content: Instagram, Reddit, Bluesky, X
- **Messaging** — real-time conversation, contacts, presence: Discord, Telegram, WhatsApp
- **Content Platforms** — articles, videos, reference content: YouTube, Hacker News, Wikipedia, ChatGPT, Google Maps

## Expected Operations

**Social Media:**
- Read: feed/timeline (paginated), user profile, search, explore/trending
- Write (reversible pairs):
  - createPost / deletePost
  - reply / deleteReply
  - like / unlike
  - repost (retweet, reblog) / unrepost
  - bookmark (save) / unbookmark (unsave)
  - follow / unfollow
  - comment / deleteComment
- Write (one-way): quote-post (creates new post, delete to undo)

**Messaging:**
- Read: list conversations (paginated), read messages (paginated), list contacts, search messages
- Write (reversible pairs):
  - sendMessage / deleteMessage
  - addReaction / removeReaction
  - pinMessage / unpinMessage
- Write (one-way): markAsRead, editMessage
- Real-time: WebSocket gateway for events

**Content Platforms:**
- Read: feed/homepage (paginated), content detail (by ID), search, user/channel profile, comments (paginated)
- Write (reversible pairs):
  - like / unlike
  - subscribe / unsubscribe
  - save / unsave (playlists, bookmarks)
  - comment / deleteComment
  - addToPlaylist / removeFromPlaylist (music/video)

## Typical Profile

| Aspect | Social Media | Messaging | Content |
|--------|-------------|-----------|---------|
| Auth | cookie_session + CSRF | cookie_session, webpack_module_walk | varies |
| Transport | node or page (TLS fingerprint) | page (adapter) | node |
| Extraction | direct API or SSR | adapter (internal state) | API, SSR, or html_selector |
| Pagination | cursor (next_max_id, after) | cursor | cursor or offset |
| Bot detection | moderate to heavy | low (browser-only) | varies |

## Notable Patterns

- **X/Twitter:** CSRF on ALL methods including GET. Page transport required (TLS fingerprint). Custom signing via `x-client-transaction-id` (webpack module function).
- **LinkedIn:** Voyager REST + GraphQL hybrid API. CSRF on ALL methods (JSESSIONID -> csrf-token). Page transport required (node triggers redirect-loop rate limiting). PerimeterX detection. Rest.li tuple parameter encoding.
- **Instagram:** REST API v1 at `/api/v1/`. Requires `x-ig-app-id: 936619743392459` and `x-requested-with: XMLHttpRequest` as const headers (400 without). Page transport required (Meta bot detection). CSRF `csrftoken` cookie -> `x-csrftoken` header on POST only. Media IDs are numeric PKs, not URL shortcodes.
- **Discord:** webpack_module_walk for auth token extraction. `app_path: /channels/@me` (bundle only loads on authenticated pages).
- **WhatsApp:** Metro-style `require('WAWeb*')` with string IDs (not webpack). Adapter reads Backbone-style collections directly — no HTTP API exists.
- **Telegram:** webpack_module_walk via `webpackChunktelegram-web`.
- **YouTube:** sapisidhash signing for authenticated requests.
- **Google Maps:** adapter-only, protobuf-like `pb` parameters.
- **Bluesky:** AT Protocol XRPC at `public.api.bsky.app`. No auth for reads, no bot detection, `node` transport. Compiler path normalization merges XRPC methods — manual spec curation required.
- **Pinterest:** Resource API pattern (`/resource/{ResourceName}/get/?data={JSON}`). Page transport required. CSRF on POST only (`csrftoken` -> `x-csrftoken`). Requires `x-requested-with: XMLHttpRequest` + `x-pinterest-appstate` + `x-pinterest-pws-handler` as const params.

## Curation Checklist

**Social Media:**
- [ ] Feed returns real posts (not empty or login-gated)
- [ ] Pagination works (cursor advances)
- [ ] Write ops gated with `write` permission
- [ ] Every write op has its reverse (like/unlike, follow/unfollow, etc.)
- [ ] CSRF header present on mutations
- [ ] Profile returns structured user data (not HTML)
- [ ] deletePost/deleteComment test with content you created (not others')

**Messaging:**
- [ ] WebSocket gateway captured? Check asyncapi.yaml alongside openapi.yaml
- [ ] Adapter correctly extracts from internal state (not DOM scraping)
- [ ] Message send gated with `write` permission
- [ ] deleteMessage works on own messages only
- [ ] Conversation list paginated (not unbounded)

**Content Platforms:**
- [ ] Search returns structured results (not HTML page)
- [ ] Content detail includes full text/body (not truncated)
- [ ] Signed requests have correct hash computation
- [ ] SSR extraction targets correct data path (e.g., `__NEXT_DATA__.props.pageProps`)
- [ ] subscribe/unsubscribe pair both work
