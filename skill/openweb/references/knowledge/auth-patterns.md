# Auth Patterns

Guide to authentication primitives detected by `classify.ts`. Organized by primitive type.

## Routing Table

**Note:** Archetype docs and DOC.md files may use high-level auth labels (e.g.,
`oauth2`, `bearer_token`) that map to one of the primitives below. Example:
`oauth2` often manifests as `exchange_chain`, `localStorage_jwt`, or
`sessionStorage_msal` in captured browser traffic.

| Primitive | Category | Quick Signal |
|---|---|---|
| cookie_session | Auth | Session cookies correlated across requests |
| cookie_to_header | CSRF | Cookie value → request header |
| meta_tag | CSRF | `<meta>` content → request header |
| api_response | CSRF | JSON response body → request header |
| localStorage_jwt | Auth | JWT (`eyJ…`) in localStorage |
| sessionStorage_msal | Auth | MSAL token keys in sessionStorage |
| exchange_chain | Auth | Token endpoint → bearer header |
| webpack_module_walk | Auth | Token in webpack chunk cache |
| page_global | Auth | Auth data in JS global |
| sapisidhash | Signing | SAPISID + origin → SHA-1 header |
| custom_signing | Signing | Per-request computed params (VM) |

## cookie_session

**Detection**: Correlate cookies set in responses with cookies sent in subsequent requests. Exclude tracking cookies (Google Analytics, Cloudflare, Meta, consent banners — see TRACKING_COOKIE_PREFIXES in classify.ts).

**Common signals**:
- Session cookies (names like `session`, `sid`, `token`, `auth`)
- Cookies that appear in authenticated requests but not unauthenticated ones

**Pitfalls**:
- **False positive on public APIs**: Public APIs may set tracking cookies that look like sessions. Verify with `node_no_auth` probe first — if the API works without cookies, it's not auth.
- **Cloudflare cookies**: `__cf_bm`, `__cfruid`, `cf_clearance` are infrastructure, not auth. Excluded by denylist.
- **Google auth cookies**: `SID`, `HSID`, `SSID`, `SAPISID`, `SIDCC` — these ARE real auth cookies. Do NOT add to denylist.

**Troubleshooting**:
- 401/403 after token cache hit → Clear cache and retry with fresh browser extraction. Tokens may be expired.
- Cookie not detected → Check if site uses localStorage or sessionStorage instead.

## cookie_to_header (CSRF)

**Detection**: Find a cookie whose value appears as a request header value (e.g., `ct0` cookie → `x-csrf-token` header).

**Common signals**:
- Cookie name + header name correlation
- Header typically named `x-csrf-token`, `x-xsrf-token`, or site-specific

**Pitfalls**:
- **Scope matters**: Some sites (X/Twitter) require CSRF on ALL methods including GET. Check `scope` field.
- **Cookie rotation**: CSRF cookies may rotate on each response. Always read fresh value.

## meta_tag (CSRF)

**Detection**: `<meta>` tag with `name="csrf-token"` or similar, whose `content` matches a request header value.

**Common signals**:
- `<meta name="csrf-token" content="...">` in page HTML
- GitHub uses this pattern

## api_response (CSRF)

**Detection**: CSRF token extracted from a JSON API response body, then sent as a request header on subsequent calls.

**Common signals**:
- Initial API call returns `{ "csrf_token": "..." }` or similar field
- Token value appears verbatim in a subsequent request header
- Often from session/config endpoints (e.g., `/api/session`, `/api/config`)

**Pitfalls**:
- **Distinguish from exchange_chain**: exchange_chain produces a bearer/auth token; api_response produces a CSRF token paired with cookie_session.
- **Token rotation**: Some sites rotate the CSRF token per response. Always extract from the latest response.
- **Nested extraction**: Token may be deeply nested in response JSON — classifier uses path matching.

## localStorage_jwt

**Detection**: localStorage key containing `JWT` or `token` with value starting with `eyJ` (base64 JWT prefix).

**Common signals**:
- localStorage keys like `jwtToken`, `access_token`, `auth_token`
- Value is a JWT (three dot-separated base64 segments)

**Pitfalls**:
- JWT expiry — check `exp` claim. Short-lived tokens need frequent refresh.

## sessionStorage_msal

**Detection**: sessionStorage key matching `msal.token.keys.*` pattern.

**Common signals**:
- Microsoft MSAL library stores tokens in sessionStorage
- Keys follow `msal.{clientId}.{key}` pattern

**Examples**: Microsoft Word (Graph API bearer token from MSAL cache)

## exchange_chain

**Detection**: POST to token-like endpoint that returns a bearer token used in subsequent requests. Most heuristic detector in classify.ts.

**Common signals**:
- Step 1: Extract cookie or initial token from browser
- Step 2: POST to token endpoint → receive bearer/access token
- Step 3: Use token in Authorization header

**Pitfalls**:
- **Multi-step chains**: Some sites have 2+ exchange steps (Reddit: cookie → shreddit token → bearer JWT).
- **GET method**: Some exchange endpoints use GET, not POST (ChatGPT session endpoint). Check `method` field.
- **Cookie extraction**: Some chains start by reading a browser cookie (`extract_from: 'cookie'`), not an HTTP response.

**Examples**:
- Reddit: cookie CSRF → POST shreddit/token → bearer JWT → oauth.reddit.com
- ChatGPT: GET session endpoint → access token (Cloudflare User-Agent binding)

## webpack_module_walk

**Detection**: Token stored in webpack module cache, accessed via `webpackChunkXxx` global.

**Common signals**:
- Global variable matching `webpackChunk*`
- Token in module exports (often deeply nested)

**Examples**: Discord (token in webpack module cache, page transport required)

## page_global

**Detection**: Auth data available as a page-level JavaScript global variable.

**Common signals**:
- `window.ytcfg` (YouTube), `window.__NEXT_DATA__` (Next.js apps)
- Data accessible via `page.evaluate()`

**Examples**: YouTube (ytcfg contains auth credentials for API calls)

## sapisidhash (Signing)

**Detection**: `SAPISIDHASH` in request headers. Requires `SAPISID` cookie + origin for SHA-1 hash computation.

**Common signals**:
- Google properties (YouTube, etc.)
- Header format: `<timestamp>_<sha1(timestamp + " " + sapisid + " " + origin)>`

**Pitfalls**:
- Requires both the SAPISID cookie AND the correct origin to compute the hash.

## custom_signing (X-Bogus / VM-based)

**Detection**: Query parameters like `X-Bogus`, `X-Gnarly`, `msToken` that change on every request and don't match any cookie or localStorage value.

**Common signals**:
- Parameters computed by obfuscated client-side JavaScript (often VM-based bytecode interpreters)
- Values change per-request, not per-session
- Cannot be reproduced outside the browser context
- Often paired with cookie_session auth

**Examples**: TikTok (X-Bogus + X-Gnarly + msToken on every API request)

**Pitfalls**:
- Standard compile cannot handle — requires page transport with adapter extraction to execute API calls from within the browser where the signing JS runs.
- Sites using custom_signing often also serve content via SSR rather than API calls, requiring page.evaluate() extraction.

## No Auth Detected

If classify.ts detects no auth primitive:
1. The site may genuinely be public (most L1 site packages)
2. The capture may be missing authenticated traffic — was the user logged in during capture?
3. The site may use an auth pattern not yet supported (check for bearer tokens in headers, OAuth redirects, etc.)

## Related References

- `references/discover.md` — discovery workflow where auth is first encountered
- `references/compile.md` — compile review where auth detection is verified
- `references/knowledge/troubleshooting-patterns.md` — auth failure patterns
