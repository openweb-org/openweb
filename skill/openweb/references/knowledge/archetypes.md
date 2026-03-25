# Site Archetypes

Patterns extracted from 51 compiled sites (M0–M21). Read this before compiling a new site to set expectations for auth, transport, key pages, and common pitfalls.

M22 coverage sweep (redo): 105 OpenTabs plugins classified → 17 A (has fixture), 35 B (L1 compilable, api_key/bearer_token), 48 C (L2 needs browser login), 1 D (needs new primitive), 4 E (needs L3 adapter), 0 F. 49.5% immediately compilable (A+B), 95.2% reachable with existing primitives (A+B+C).

Note: 34 of our 51 fixtures are for sites NOT in the OpenTabs 105 set (fun/reference/weather APIs). Those archetypes are well-covered but not listed in OpenTabs plugins.

## Social Media (M22: 4/10 OpenTabs plugins, 40%)

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
**TikTok**: BLOCKED. cookie_session auth. X-Bogus/X-Gnarly custom signing (client-side VM-based anti-bot) on ALL API requests. Core content (search, video detail, user profile) served via SSR `__UNIVERSAL_DATA_FOR_REHYDRATION__` (not API calls). Needs L3 adapter: browser_fetch transport + page.evaluate() SSR extraction. msToken dynamic signing also present.

Expected Operations:
- [ ] Feed / timeline (read, paginated)
- [ ] User profile (read, by ID or username)
- [ ] Post / create content (write)
- [ ] Like / react (write)
- [ ] Comment (write)
- [ ] Search users or posts (read)
- [ ] Direct messages / inbox (read)

## Messaging (M22: 3/6 OpenTabs plugins, 50%)

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

## Developer Tools (M22: 4/26 OpenTabs plugins, 15% fixture | 85% compilable)

Auth: cookie_session, none, or header-based key/token (modeled as OpenAPI parameters, not primitives)
Transport: node
Key pages: /repos, /issues, /pulls, /packages, /search
Pagination: link_header (GitHub) or cursor
Examples: GitHub, npm, StackOverflow

**GitHub**: cookie_session + meta_tag CSRF. link_header pagination. Also has unauthenticated public API (github-public).
**npm**: No auth. Node transport. Package search + metadata.
**Docker Hub**: Public search API (`/api/search/v3/catalog/search`) + v2 repository API (`/v2/repositories/`). JWT bearer for user-specific actions (obtained from `/auth/profile`). Public endpoints work without auth.
**Grafana**: cookie_session. Relative API paths (`/api/*`). Self-hosted instances use configSchema URL.
**PostHog**: cookie_session + cookie_to_header CSRF (`posthog_csrftoken`). Team/org IDs from page global `window.POSTHOG_APP_CONTEXT`.
**CockroachDB**: cookie_session over gRPC-Web (`/console.ManagementConsole/*`). Binary protobuf encoding, not JSON.
**StackOverflow**: No auth. Node transport. Search with answers.

Expected Operations:
- [ ] List repos / projects (read, paginated)
- [ ] Repo / project detail (read, by ID or name)
- [ ] List issues / items (read, paginated)
- [ ] Create issue / item (write)
- [ ] Search (read)
- [ ] User / org profile (read)

## Weather / Data APIs (not in OpenTabs 105; 5 fixtures from external APIs)

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

## E-commerce (M22: 1/9 OpenTabs plugins, 11%)

Auth: cookie_session + csrf_token
Transport: node (with SSR extraction)
Key pages: /products, /cart, /search, /account
Write ops: add-to-cart, checkout — identify but assign `transact` permission
Extraction: ssr_next_data or script_json common
Examples: Walmart

**Walmart**: ssr_next_data extraction (Next.js `__NEXT_DATA__`). Node transport — direct HTTP fetch returns full SSR payload. CDP browser blocked by PerimeterX bot detection (even non-headless). Use node-based SSR extraction (no browser needed). Search, product detail, and pricing all available via `__NEXT_DATA__` paths. Search results use flat pricing (`priceInfo.linePrice`), PDP uses nested pricing (`priceInfo.currentPrice.price`).
**Best Buy**: Page transport (browser_fetch) required — Akamai bot protection blocks all direct HTTP and headless PDP navigation (HTTP/2 protocol errors). Three internal REST APIs work via same-origin fetch: `/suggest/v1/fragment/suggest/www?query=` (search by keyword, returns SKU IDs + categories), `/suggest/v1/fragment/products/www?skuids=` (product name/image/rating/reviews), `/api/3.0/priceBlocks?skus=` (full pricing with current/regular/savings). No auth for public data, but session cookies (SID, CTT) must be present. Compiler cannot handle this site — manual fixture creation required.
**eBay**: SSR HTML extraction (DOMParser). Autocomplete uses JSONP (`/autosug`), not JSON. Session cookies + CSRF for user actions.
**Yelp**: SSR HTML with `window.yelp.react_root_props` embedded JSON. Public autocomplete API at `/search_suggest/v2/prefetch?prefix=&loc=`. DataDome bot detection blocks CDP browser and direct HTTP fetch — currently blocked for fixture creation.
**Zillow**: PerimeterX bot detection (app ID `PXHYx10rg3`) blocks all access — CDP browser, direct HTTP, and even real browsers after IP poisoning from automated probes. Five-layer detection: TLS fingerprint, HTTP/2 fingerprint, JS challenge, behavioral analysis, IP reputation. Known API endpoints: search (`PUT /search/GetSearchPageState.htm` with JSON body), GraphQL (`/zg-graph`, `/graphql`), autocomplete (`/autocomplete/v3/suggestions`), property detail (`/homedetails/{address}/{zpid}_zpid/`). All behind PX. `robots.txt` accessible. Currently blocked for fixture creation.

Expected Operations:
- [ ] Search products (read)
- [ ] Product detail (read, by ID)
- [ ] Add to cart (write)
- [ ] View cart (read)
- [ ] Checkout (transact — deny by default)

## Content Platforms (M22: 4/15 OpenTabs plugins, 27%)

Auth: exchange_chain, cookie_session, or sessionStorage_msal
Transport: node
Key pages: /feed, /video, /article, /search
Signing: sapisidhash (Google properties)
Examples: YouTube, Hacker News, Wikipedia, ChatGPT

**YouTube**: page_global auth + sapisidhash signing. Node transport. Complex signing requires SAPISID cookie + origin hash.
**Hacker News**: html_selector extraction. No auth. Node transport.
**ChatGPT**: exchange_chain (GET session endpoint) + Cloudflare User-Agent binding.
**Wikipedia**: No auth. Node transport. Search + page summary.
**Google Maps**: L3 adapter. Search and directions use SPA navigation + DOM extraction (APIs need session-specific tokens only generated during navigation). Place details work via direct `page.evaluate(fetch())` to `/maps/preview/place?pb=...`. Protobuf-like `pb` parameter with `!` delimiters. Responses are JSON prefixed with `)]}'`. No SAPISIDHASH needed for public data (unauthenticated). Compiler cannot handle — manual fixture. Place data at response[6] is 200+ element positional array.

Expected Operations:
- [ ] Feed / homepage (read, paginated)
- [ ] Content detail (read, by ID or URL)
- [ ] Search content (read)
- [ ] User / channel profile (read)
- [ ] Comment / reply (write)

## Productivity / Enterprise (M22: 1/17 OpenTabs plugins, 6% fixture | 76% compilable)

Auth: sessionStorage_msal, cookie_session, or exchange_chain
Transport: node
Key pages: /profile, /dashboard, /documents
GraphQL: common for dashboard APIs
Examples: Microsoft Word, New Relic

**Microsoft Word**: sessionStorage_msal auth (MSAL token cache from browser storage). Graph API bearer token.
**New Relic**: cookie_session. GraphQL cursor pagination for dashboards.

**Stripe**: page_global auth (PRELOADED object contains session_api_key, merchant.id, csrf_token). Dashboard proxies Stripe API through same-origin `/v1/*` endpoints. Also has `/ajax/*` namespace for internal dashboard endpoints. Compile from dashboard traffic generates heavy noise (~80 internal ops per ~20 useful API ops) — curation step must filter `/ajax/*`, `/conversations/`, `/_extraction/`, `/v3/` paths.

**Linear**: cookie_session (HttpOnly, SameSite=Strict). GraphQL at `client-api.linear.app/graphql`. SPA renders login at root URL without redirect — check `isLoggedInUser` in GraphQL telemetry to confirm auth status. Auth context from localStorage `ApplicationStore` (userId, orgId, clientId). Custom headers: `useraccount`, `user`, `organization`, `linear-client-id`.
**Asana**: cookie_session (HttpOnly `auth_token`). REST API at `/api/1.0`. Write operations need `X-Allow-Asana-Client: 1` header.
**CircleCI**: cookie_session (HttpOnly). REST API at `/api/v2`. Next.js SSR — auth detected via `__NEXT_DATA__` presence.
**MongoDB Atlas**: cookie_session + meta_tag CSRF (`X-CSRF-Token` from `PARAMS.csrfToken` page global). Context IDs from `PARAMS.appUser.id`, `currentGroup.id`.
**Twilio**: Unique: fetches credentials from `/console/api/v2/projects/info` → HTTP Basic Auth with accountSid:authToken. POST/PUT use `application/x-www-form-urlencoded`.
**Webflow**: cookie_session + meta_tag CSRF (`_csrf` meta → `X-CSRF-Token`). REST API at `/api`.
**YNAB**: session token from `<meta name="session-token">`. Dual API: Catalog RPC (`/api/v1/catalog`) with `operation_name` + `request_data`, and REST (`/api/v2`). Write operations need `server_knowledge` sync.
**Zendesk**: cookie_session + CSRF from `<meta name="csrf-token">` or `_zendesk_csrf` cookie. REST API at `/api/v2`. Instance-specific subdomain (e.g., `company.zendesk.com`).
**Amplitude**: cookie_session (`onenav_jwt_prod`). GraphQL at relative `/t/graphql/org/{orgId}`. Org context from URL pattern and `intercomSettings.org_id` page global.

Note: In the 105-plugin classification, New Relic is grouped under DevTools. Microsoft Word is the sole Productivity fixture. 12 B-category plugins (jira, confluence, notion, figma, linear, airtable, asana, clickup, todoist, shortcut, calendly, zendesk) are immediately compilable once logged in.

Expected Operations:
- [ ] List documents / items (read, paginated)
- [ ] Document / item detail (read, by ID)
- [ ] Create document / item (write)
- [ ] Update document / item (write)
- [ ] Search (read)
- [ ] Dashboard / overview (read)

## Prediction / Fun APIs (not in OpenTabs 105; 12 fixtures from external APIs)

Auth: none
Transport: node
Key pages: single endpoint per service
Usually: simple GET with query params, JSON response, no pagination
Examples: Agify, Genderize, Nationalize, Cat Facts, Chuck Norris, Advice Slip, Kanye Rest, Official Joke, Useless Facts, Affirmations, Random Fox, Bored API

These are the simplest archetype — no auth, no CSRF, no signing, single-operation fixtures.

Expected Operations:
- [ ] Query / predict (read, single call)
- [ ] Random result (read)

## Reference / Lookup APIs (M22: 0/2 OpenTabs plugins; 15 fixtures from external APIs)

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

## Crypto / Finance (M22: 0/4 OpenTabs plugins, 0%; 2 fixtures from external APIs)

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

## News (not in OpenTabs 105; 0 fixtures)

Auth: none or header-based key (modeled as OpenAPI parameter)
Transport: node
Key pages: /articles, /feed, /search, /headlines
Extraction: RSS or html_selector common; multi-page content may need aggregate extraction
Examples: BBC, AP News, The Guardian, NewsAPI.org

Expected Operations:
- [ ] Headlines / feed (read, paginated)
- [ ] Article detail (read, by ID or URL)
- [ ] Search articles (read)

## Email (not in OpenTabs 105; 0 fixtures)

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

## Cloud / Storage (M22: 0/4 OpenTabs plugins, 0%)

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

## Travel (M22: 0/6 OpenTabs plugins, 0%)

Auth: cookie_session (all 6 plugins use browser session)
Transport: node (REST/GraphQL via cookies)
Key pages: /search, /listing, /booking, /account
Anti-bot: varies (Airbnb heavy, others moderate)
Examples: Airbnb, Booking.com, Expedia, Priceline, TripAdvisor, Uber

**Google Flights**: page_global_data extraction from SPA. No separate REST API — data delivered via internal `FlightsFrontendService` RPC calls (`GetShoppingResults`, `GetBookingResults`, `GetCalendarPicker`, `GetExploreDestinations`) triggered automatically by page JavaScript. Search parameters encoded in URL `tfs` param (protobuf-encoded base64). Flight results rendered in `li.pIav2d` elements with text containing times, airline, route, price, CO2. Text uses `\u00A0` (NBSP) and `\u2013` (en-dash) — regex must account for these. Headless browsers blocked by Google bot detection; must use managed (non-headless) browser for capture. Auto-compiler cannot handle this site — manual fixture required.

Expected Operations:
- [ ] Search listings (read, paginated)
- [ ] Listing detail (read, by ID)
- [ ] Price / availability (read)
- [ ] Book / reserve (transact — deny by default)

## Food Delivery (M22: 0/6 OpenTabs plugins, 0%)

Auth: cookie_session (all 6 plugins use browser session)
Transport: node or page
Key pages: /restaurants, /menu, /cart, /orders
GraphQL persisted queries common (Instacart)
Examples: Chipotle, Dominos, DoorDash, Instacart, Panda Express, Starbucks

Expected Operations:
- [ ] Search restaurants (read, paginated)
- [ ] Restaurant menu (read, by ID)
- [ ] Add to cart (write)
- [ ] Place order (transact — deny by default)
