# Site Archetypes

Patterns extracted from 51 compiled sites (M0–M21). Read this before compiling a new site to set expectations for auth, transport, key pages, and common pitfalls.

M22 coverage sweep: 144 sites surveyed across 15 archetypes → 51 A (has fixture), 46 B (L1 compilable, incl. api_key/bearer_token), 24 C (L2 needs browser login), 13 D (needs new primitive), 8 E (needs L3 adapter), 2 F (not suitable). 67% immediately compilable, 84% reachable with L2 login.

## Social Media (M22: 4/12 fixture coverage, 33%)

Auth: cookie_session (+ cookie_to_header CSRF, exchange_chain for OAuth)
Transport: node or page (depends on TLS fingerprinting)
Key pages: /feed, /profile, /messages, /notifications, /stories
SPA: wait for feed render before capture stop
Write ops: like, comment, post — identify but gate with `write` permission
Examples: Instagram, Reddit, Bluesky, X

**Instagram**: cookie_session + cookie_to_header CSRF. Node transport. Cursor pagination via `next_max_id`.
**Reddit**: cookie_session → exchange_chain (shreddit/token → bearer JWT → oauth.reddit.com).
**Bluesky**: localStorage_jwt auth. Node transport. Cursor pagination.
**X (Twitter)**: browser_fetch transport (TLS fingerprint). cookie_to_header CSRF on ALL methods (including GET). Static bearer as const header.

Expected Operations:
- [ ] Feed / timeline (read, paginated)
- [ ] User profile (read, by ID or username)
- [ ] Post / create content (write)
- [ ] Like / react (write)
- [ ] Comment (write)
- [ ] Search users or posts (read)
- [ ] Direct messages / inbox (read)

## Messaging (M22: 3/9 fixture coverage, 33%)

Auth: cookie_session, webpack_module_walk, or browser state (L3)
Transport: page or adapter (L3)
Key pages: /conversations, /messages, /contacts
Real-time: WebSocket/SSE — capture cannot intercept, mark as known limitation
Examples: Discord, Telegram, WhatsApp

**Discord**: webpack_module_walk token extraction. browser_fetch transport. Token lives in webpack module cache.
**Telegram**: L3 adapter. teact getGlobal() dynamic discovery via webpack walk. State read from global store.
**WhatsApp**: L3 adapter. Meta `__d`/`__w`/`require` module system. State read from internal modules.

Expected Operations:
- [ ] List conversations (read, paginated)
- [ ] Read messages in conversation (read, paginated)
- [ ] Send message (write)
- [ ] List contacts / friends (read)
- [ ] Search messages (read)

## Developer Tools (M22: 4/14 fixture coverage, 29%)

Auth: cookie_session, none, or header-based key/token (modeled as OpenAPI parameters, not primitives)
Transport: node
Key pages: /repos, /issues, /pulls, /packages, /search
Pagination: link_header (GitHub) or cursor
Examples: GitHub, npm, StackOverflow

**GitHub**: cookie_session + meta_tag CSRF. link_header pagination. Also has unauthenticated public API (github-public-fixture).
**npm**: No auth. Node transport. Package search + metadata.
**StackOverflow**: No auth. Node transport. Search with answers.

Expected Operations:
- [ ] List repos / projects (read, paginated)
- [ ] Repo / project detail (read, by ID or name)
- [ ] List issues / items (read, paginated)
- [ ] Create issue / item (write)
- [ ] Search (read)
- [ ] User / org profile (read)

## Weather / Data APIs (M22: 5/10 fixture coverage, 50%)

Auth: none or header-based key (modeled as OpenAPI parameter)
Transport: node
Key pages: /api/*, /forecast, /current
Usually: REST JSON, no CSRF, no signing
Examples: Open-Meteo, IP API, Exchange Rate, Sunrise Sunset, World Time

**Open-Meteo**: No auth. Query params for latitude/longitude/hourly fields. JSON response.

Expected Operations:
- [ ] Current data (read, by location or params)
- [ ] Forecast / historical (read, by range)
- [ ] Lookup by coordinates or ID (read)

## E-commerce (M22: 1/8 fixture coverage, 13%)

Auth: cookie_session + csrf_token
Transport: node (with SSR extraction)
Key pages: /products, /cart, /search, /account
Write ops: add-to-cart, checkout — identify but assign `transact` permission
Extraction: ssr_next_data or script_json common
Examples: Walmart

**Walmart**: ssr_next_data extraction (Next.js `__NEXT_DATA__`). Page extraction transport.

Expected Operations:
- [ ] Search products (read)
- [ ] Product detail (read, by ID)
- [ ] Add to cart (write)
- [ ] View cart (read)
- [ ] Checkout (transact — deny by default)

## Content Platforms (M22: 4/15 fixture coverage, 27%)

Auth: exchange_chain, cookie_session, or sessionStorage_msal
Transport: node
Key pages: /feed, /video, /article, /search
Signing: sapisidhash (Google properties)
Examples: YouTube, Hacker News, Wikipedia, ChatGPT

**YouTube**: page_global auth + sapisidhash signing. Node transport. Complex signing requires SAPISID cookie + origin hash.
**Hacker News**: html_selector extraction. No auth. Node transport.
**ChatGPT**: exchange_chain (GET session endpoint) + Cloudflare User-Agent binding.
**Wikipedia**: No auth. Node transport. Search + page summary.

Expected Operations:
- [ ] Feed / homepage (read, paginated)
- [ ] Content detail (read, by ID or URL)
- [ ] Search content (read)
- [ ] User / channel profile (read)
- [ ] Comment / reply (write)

## Productivity / Enterprise (M22: 2/13 fixture coverage, 15%)

Auth: sessionStorage_msal, cookie_session, or exchange_chain
Transport: node
Key pages: /profile, /dashboard, /documents
GraphQL: common for dashboard APIs
Examples: Microsoft Word, New Relic

**Microsoft Word**: sessionStorage_msal auth (MSAL token cache from browser storage). Graph API bearer token.
**New Relic**: cookie_session. GraphQL cursor pagination for dashboards.

Expected Operations:
- [ ] List documents / items (read, paginated)
- [ ] Document / item detail (read, by ID)
- [ ] Create document / item (write)
- [ ] Update document / item (write)
- [ ] Search (read)
- [ ] Dashboard / overview (read)

## Prediction / Fun APIs (M22: 12/14 fixture coverage, 86%)

Auth: none
Transport: node
Key pages: single endpoint per service
Usually: simple GET with query params, JSON response, no pagination
Examples: Agify, Genderize, Nationalize, Cat Facts, Chuck Norris, Advice Slip, Kanye Rest, Official Joke, Useless Facts, Affirmations, Random Fox, Bored API

These are the simplest archetype — no auth, no CSRF, no signing, single-operation fixtures.

Expected Operations:
- [ ] Query / predict (read, single call)
- [ ] Random result (read)

## Reference / Lookup APIs (M22: 15/23 fixture coverage, 65%)

Auth: none
Transport: node
Key pages: /search, /lookup, /{id}
Pagination: offset or cursor (varies)
Examples: PokeAPI, REST Countries, Open Library, DuckDuckGo, Dog CEO, HTTPBin, CocktailDB, Color API, Country.is, Dictionary API, Public Holidays, Universities, Zippopotam, Random User

These are public APIs with richer schemas — multiple operations, path parameters, varied response shapes.

Expected Operations:
- [ ] Search / list (read, paginated or filtered)
- [ ] Detail by ID or name (read)
- [ ] Random entry (read, if supported)

## Crypto / Finance (M22: 2/8 fixture coverage, 25%)

Auth: none or header-based key (modeled as OpenAPI parameter)
Transport: node
Key pages: /price, /market, /exchange
Examples: CoinGecko, Exchange Rate

**CoinGecko**: No auth for basic endpoints. Price queries by coin ID + currency.

Expected Operations:
- [ ] Price query (read, by asset + currency)
- [ ] Market data / rankings (read, paginated)
- [ ] Exchange rates (read)
- [ ] Historical data (read, by range)

## News (M22: 0/6 fixture coverage, 0%)

Auth: none or header-based key (modeled as OpenAPI parameter)
Transport: node
Key pages: /articles, /feed, /search, /headlines
Extraction: RSS or html_selector common; multi-page content may need aggregate extraction
Examples: BBC, AP News, The Guardian, NewsAPI.org

Expected Operations:
- [ ] Headlines / feed (read, paginated)
- [ ] Article detail (read, by ID or URL)
- [ ] Search articles (read)

## Email (M22: 0/2 fixture coverage, 0%)

Auth: oauth2 (PKCE) or sessionStorage_msal
Transport: node
Key pages: /inbox, /messages, /compose, /contacts
Gap: OAuth2 PKCE primitive needed for Gmail; MSAL pattern available for Outlook
Examples: Gmail, Outlook

Expected Operations:
- [ ] List inbox / messages (read, paginated)
- [ ] Read message (read, by ID)
- [ ] Send message (write)
- [ ] Search messages (read)

## Cloud / Storage (M22: 0/4 fixture coverage, 0%)

Auth: bearer_token (modeled as OpenAPI parameter) or sessionStorage_msal
Transport: node
Key pages: /files, /folders, /shared, /search
Gap: OAuth2 PKCE needed for Google Drive
Examples: Dropbox, OneDrive, Box

Expected Operations:
- [ ] List files / folders (read, paginated)
- [ ] File metadata (read, by ID)
- [ ] Upload file (write)
- [ ] Download file (read)
- [ ] Search files (read)

## Travel (M22: 0/4 fixture coverage, 0%)

Auth: cookie_session or proprietary
Transport: adapter (L3) for most; heavy anti-bot
Key pages: /search, /listing, /booking, /account
Most travel sites need L3 adapters due to anti-bot, dynamic API versioning, and complex search flows
Examples: Booking.com, Airbnb, Expedia

Expected Operations:
- [ ] Search listings (read, paginated)
- [ ] Listing detail (read, by ID)
- [ ] Price / availability (read)
- [ ] Book / reserve (transact — deny by default)

## Food Delivery (M22: 0/3 fixture coverage, 0%)

Auth: cookie_session or proprietary
Transport: node or adapter (L3)
Key pages: /restaurants, /menu, /cart, /orders
GraphQL persisted queries common (DoorDash, Uber Eats)
Examples: DoorDash, Uber Eats, Grubhub

Expected Operations:
- [ ] Search restaurants (read, paginated)
- [ ] Restaurant menu (read, by ID)
- [ ] Add to cart (write)
- [ ] Place order (transact — deny by default)
