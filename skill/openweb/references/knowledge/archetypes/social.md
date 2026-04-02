# Social, Messaging & Content

> Archetypes are heuristic starting points, not limiting checklists.

## Classification

User-facing sites focused on content consumption, social interaction, and communication.

- **Social Media** — feed-based, user-generated content: Instagram, Reddit, Bluesky, X, TikTok
- **Messaging** — real-time conversation, contacts, presence: Discord, Telegram, WhatsApp
- **Content Platforms** — articles, videos, reference content: YouTube, Hacker News, Wikipedia, ChatGPT, Google Maps

## Expected Operations

### Social Media
- Feed / timeline (read, paginated)
- User profile (read, by ID or username)
- Post / create content (write)
- Like / react (write)
- Comment (write)
- Search users or posts (read)

### Messaging
- List conversations (read, paginated)
- Read messages in conversation (read, paginated)
- Send message (write)
- List contacts / friends (read)
- Search messages (read)
- WebSocket gateway — real-time events

### Content Platforms
- Feed / homepage (read, paginated)
- Content detail (read, by ID or URL)
- Search content (read)
- User / channel profile (read)
- Comment / reply (write)

## Typical Profile

| Aspect | Social Media | Messaging | Content |
|--------|-------------|-----------|---------|
| Auth | cookie_session + CSRF | cookie_session, webpack_module_walk | varies |
| Transport | node or page (TLS fingerprint) | page (adapter) | node |
| Extraction | direct API or SSR | adapter (internal state) | API, SSR, or html_selector |
| Pagination | cursor (next_max_id, after) | cursor | cursor or offset |
| Bot detection | moderate to heavy | low (browser-only) | varies |

**Notable patterns:**
- X: CSRF on ALL methods including GET, page transport required (TLS fingerprint)
- LinkedIn: Voyager REST + GraphQL hybrid API, CSRF on ALL methods (JSESSIONID → csrf-token), page transport required (node triggers redirect-loop rate limiting), PerimeterX detection, Rest.li tuple parameter encoding
- TikTok: BLOCKED — VM-based anti-bot signing, SSR extraction only via adapter
- Discord: webpack_module_walk for auth token extraction
- WhatsApp: Metro-style `require('WAWeb*')` with string IDs (not webpack) — adapter reads Backbone-style collections directly, no HTTP API exists
- Telegram: webpack_module_walk via `webpackChunktelegram-web`
- YouTube: sapisidhash signing for authenticated requests
- Google Maps: adapter-only, protobuf-like `pb` parameters
- Instagram: REST API v1 at `/api/v1/` (profile, feed, media) + topsearch at `/web/search/topsearch/`. Requires `x-ig-app-id: 936619743392459` and `x-requested-with: XMLHttpRequest` as const headers on `/api/v1/` endpoints (400 without them). Page transport required (Meta bot detection). CSRF `csrftoken` cookie → `x-csrftoken` header on POST only. Media IDs are numeric PKs, not URL shortcodes.
- Bluesky: AT Protocol XRPC at `public.api.bsky.app` — no auth for reads, no bot detection, `node` transport. Compiler path normalization merges XRPC methods into single endpoint — manual spec curation required.
- Pinterest: Resource API pattern (`/resource/{ResourceName}/get/?data={JSON}`), page transport required (custom header validation blocks plain fetch), CSRF on POST only (`csrftoken` cookie → `x-csrftoken` header), requires `x-requested-with: XMLHttpRequest` + `x-pinterest-appstate` + `x-pinterest-pws-handler` headers as const params.

> For auth details see [auth-patterns.md](../auth-patterns.md). For bot detection see [bot-detection-patterns.md](../bot-detection-patterns.md).

## Curation Expectations

### Social Media
- [ ] Feed returns real posts (not empty or login-gated)
- [ ] Pagination works (cursor advances)
- [ ] Write ops gated with `write` permission
- [ ] CSRF header present on mutations
- [ ] Profile returns structured user data (not HTML)

### Messaging
- [ ] WebSocket gateway captured? Check asyncapi.yaml alongside openapi.yaml
- [ ] Adapter correctly extracts from internal state (not DOM scraping)
- [ ] Message send gated with `write` permission
- [ ] Conversation list paginated (not unbounded)

### Content Platforms
- [ ] Search returns structured results (not HTML page)
- [ ] Content detail includes full text/body (not truncated)
- [ ] Signed requests have correct hash computation
- [ ] SSR extraction targets correct data path (e.g., `__NEXT_DATA__.props.pageProps`)
