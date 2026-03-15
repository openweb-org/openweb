# Layer 2: Interaction Primitives — Pattern DSL

> **NEW in v2.** The key innovation that bridges structural spec and code.
> Declarative composition of parameterized patterns for auth, CSRF, signing, etc.

## TODO

This is the most important document. For each pattern category:
1. Define the primitive's schema (YAML config format)
2. List all known variants with parameters
3. Show real-site examples (from OpenTabs plugin analysis)
4. Show how the compiler detects and emits each primitive
5. Show how the runtime executor handles each primitive

### Pattern Categories to Define

**Auth patterns** — How tokens are extracted and injected:
- `cookie_session` — Pure cookie auth
- `localStorage_jwt` — JWT from localStorage (Bluesky, ClickUp, Robinhood, etc.)
- `sessionStorage_msal` — MSAL token scanning (OneNote, PowerPoint, Excel)
- `page_global` — Token from window globals (Netflix, npm, Sentry, PostHog)
- `oauth_refresh` — OAuth refresh_token flow (Reddit, etc.)
- `gapi_proxy` — Google gapi.client.request() (5 Google services)
- `webpack_module_walk` — Token from webpack internals (Discord, X)
- `websocket_intercept` — JWT from WebSocket frames (ClickUp)
- `token_exchange` — Multi-step exchange (Teams MSAL→JWT, Reddit modhash→bearer)
- `cross_origin_bearer` — Bearer for different-domain APIs (Costco, Azure)

**CSRF patterns** — How CSRF tokens are extracted and injected:
- `cookie_to_header` — Read cookie, inject as header (Instagram, LeetCode, Bitbucket)
- `meta_tag` — Read `<meta>` content attribute (Calendly, GitHub)
- `page_global` — Read from window.xxx (Airtable, npm, Stripe)
- `form_token` — Fetch form page, extract hidden input (GitHub)
- `api_response` — Token from API response (Reddit modhash)

**Signing patterns** — Per-request cryptographic signatures:
- `sapisidhash` — Google SHA-1 time-based hash
- `aws_sigv4` — AWS request signing
- (obfuscated signers like OnlyFans/TikTok → Layer 3)

**Pagination patterns** — Cursor/offset/page state:
- `cursor` — cursor_field in response → cursor_param in next request
- `offset_limit` — offset + limit parameters
- `link_header` — RFC 8288 Link header parsing

**Extraction patterns** — Data from non-API sources:
- `ssr_next_data` — Next.js `__NEXT_DATA__` global
- `ssr_nuxt` — Nuxt `__NUXT__` / `_payload.json`
- `apollo_cache` — Apollo Client `__APOLLO_STATE__`
- `html_dom` — DOM selector-based data extraction
- `script_json` — JSON in `<script type="application/json">` tags

### x-openweb Extension for Layer 2

Show how L2 primitives integrate with the existing `x-openweb` OpenAPI extensions.
The v1 `x-openweb.session.csrf` was a minimal L2 — expand it to cover all patterns.
