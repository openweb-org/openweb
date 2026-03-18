# Site Archetypes

Patterns extracted from 51 compiled sites (M0–M18). Read this before compiling a new site to set expectations for auth, transport, key pages, and common pitfalls.

## Social Media

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

## Messaging

Auth: cookie_session, webpack_module_walk, or browser state (L3)
Transport: page or adapter (L3)
Key pages: /conversations, /messages, /contacts
Real-time: WebSocket/SSE — capture cannot intercept, mark as known limitation
Examples: Discord, Telegram, WhatsApp

**Discord**: webpack_module_walk token extraction. browser_fetch transport. Token lives in webpack module cache.
**Telegram**: L3 adapter. teact getGlobal() dynamic discovery via webpack walk. State read from global store.
**WhatsApp**: L3 adapter. Meta `__d`/`__w`/`require` module system. State read from internal modules.

## Developer Tools

Auth: api_key, bearer_token, cookie_session, or none
Transport: node
Key pages: /repos, /issues, /pulls, /packages, /search
Pagination: link_header (GitHub) or cursor
Examples: GitHub, npm, StackOverflow

**GitHub**: cookie_session + meta_tag CSRF. link_header pagination. Also has unauthenticated public API (github-public-fixture).
**npm**: No auth. Node transport. Package search + metadata.
**StackOverflow**: No auth. Node transport. Search with answers.

## Weather / Data APIs

Auth: api_key or none
Transport: node
Key pages: /api/*, /forecast, /current
Usually: REST JSON, no CSRF, no signing
Examples: Open-Meteo, IP API, Exchange Rate, Sunrise Sunset, World Time

**Open-Meteo**: No auth. Query params for latitude/longitude/hourly fields. JSON response.

## E-commerce

Auth: cookie_session + csrf_token
Transport: node (with SSR extraction)
Key pages: /products, /cart, /search, /account
Write ops: add-to-cart, checkout — identify but assign `transact` permission
Extraction: ssr_next_data or script_json common
Examples: Walmart

**Walmart**: ssr_next_data extraction (Next.js `__NEXT_DATA__`). Page extraction transport.

## Content Platforms

Auth: exchange_chain, cookie_session, or sessionStorage_msal
Transport: node
Key pages: /feed, /video, /article, /search
Signing: sapisidhash (Google properties)
Examples: YouTube, Hacker News, Wikipedia, ChatGPT

**YouTube**: page_global auth + sapisidhash signing. Node transport. Complex signing requires SAPISID cookie + origin hash.
**Hacker News**: html_selector extraction. No auth. Node transport.
**ChatGPT**: exchange_chain (GET session endpoint) + Cloudflare User-Agent binding.
**Wikipedia**: No auth. Node transport. Search + page summary.

## Productivity / Enterprise

Auth: sessionStorage_msal, cookie_session, or exchange_chain
Transport: node
Key pages: /profile, /dashboard, /documents
GraphQL: common for dashboard APIs
Examples: Microsoft Word, New Relic

**Microsoft Word**: sessionStorage_msal auth (MSAL token cache from browser storage). Graph API bearer token.
**New Relic**: cookie_session. GraphQL cursor pagination for dashboards.

## Prediction / Fun APIs

Auth: none
Transport: node
Key pages: single endpoint per service
Usually: simple GET with query params, JSON response, no pagination
Examples: Agify, Genderize, Nationalize, Cat Facts, Chuck Norris, Advice Slip, Kanye Rest, Official Joke, Useless Facts, Affirmations, Random Fox, Bored API

These are the simplest archetype — no auth, no CSRF, no signing, single-operation fixtures.

## Reference / Lookup APIs

Auth: none
Transport: node
Key pages: /search, /lookup, /{id}
Pagination: offset or cursor (varies)
Examples: PokeAPI, REST Countries, Open Library, DuckDuckGo, Dog CEO, HTTPBin, CocktailDB, Color API, Country.is, Dictionary API, Public Holidays, Universities, Zippopotam, Random User

These are public APIs with richer schemas — multiple operations, path parameters, varied response shapes.

## Crypto / Finance

Auth: none or api_key
Transport: node
Key pages: /price, /market, /exchange
Examples: CoinGecko, Exchange Rate

**CoinGecko**: No auth for basic endpoints. Price queries by coin ID + currency.
