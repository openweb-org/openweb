# Auth Primitives

Detailed reference for each auth, CSRF, and signing primitive. Per-primitive: detection signals, configuration, and gotchas.

> **Note on terminology.** "Signing" in this document refers to **HTTP request signing** (HMAC headers, `x-client-transaction-id`, `sapisidhash`, etc.) used by some sites' web APIs. OpenWeb has no cryptocurrency, wallet, blockchain, or crypto-key functionality.

For quick signal-to-primitive routing, see [auth-routing.md](auth-routing.md).

**Inject modes:** The `Inject` type defines four fields (`header`, `prefix`, `query`, `json_body_path`), but `json_body_path` is supported only by the `api_response` CSRF primitive (see `src/runtime/primitives/api-response.ts`). Auth primitives (`localStorage_jwt`, `sessionStorage_msal`, `page_global`, `webpack_module_walk`, `exchange_chain`) use `header`, `prefix`, `query` only.

---

## cookie_session

**Detection:** Correlate cookies set in responses with cookies sent in subsequent requests. Exclude tracking cookies (Google Analytics, Cloudflare, Meta, consent banners -- see TRACKING_COOKIE_PREFIXES in classify.ts).

**Common signals:**
- Session cookies (names like `session`, `sid`, `token`, `auth`)
- Cookies that appear in authenticated requests but not unauthenticated ones

**Gotchas:**
- **False positive on public APIs:** Public APIs may set tracking cookies that look like sessions. Verify with `node_no_auth` probe -- if the API works without cookies, it's not auth.
- **Cloudflare cookies:** `__cf_bm`, `__cfruid`, `cf_clearance` are infrastructure, not auth. Excluded by denylist.
- **Google auth cookies:** `SID`, `HSID`, `SSID`, `SAPISID`, `SIDCC` -- these ARE real auth cookies. Do NOT add to denylist.
- **401/403 after token cache hit:** Clear cache and retry with fresh browser extraction. Tokens may be expired.
- **Cookie not detected:** Check if site uses localStorage or sessionStorage instead.

---

## cookie_to_header (CSRF)

**Detection:** Find a cookie whose value appears as a request header value (e.g., `ct0` cookie -> `x-csrf-token` header).

**Common signals:**
- Cookie name + header name correlation
- Header typically named `x-csrf-token`, `x-xsrf-token`, or site-specific

**Gotchas:**
- **Scope matters:** Some sites require CSRF on ALL methods including GET. Check `scope` field. Note: `scope` lives on the `CsrfPrimitive` intersection in `src/types/extensions.ts` (`CsrfPrimitive & { scope?: readonly string[] }`), not on the `CsrfPrimitive` type itself in `src/types/primitives.ts`.
  - e.g. some social platforms: CSRF on all methods including GET
  - e.g. some professional networks: CSRF header required on ALL HTTP methods (`scope: [GET, POST, PUT, DELETE]`)
- **Quoted cookie values:** Some cookie values are quoted (e.g., `"ajax:123456789"`). The resolver handles quoted values.
- **Cookie rotation:** CSRF cookies may rotate on each response. Always read fresh value.

---

## meta_tag (CSRF)

**Detection:** `<meta>` tag with `name="csrf-token"` or similar, whose `content` matches a request header value.

**Common signals:**
- `<meta name="csrf-token" content="...">` in page HTML
- e.g. some developer platforms use this pattern

**Config:** Requires page transport (or initial page fetch) to read the meta tag from HTML.

---

## api_response (CSRF)

**Detection:** CSRF token extracted from a JSON API response body, then sent as a request header on subsequent calls.

**Common signals:**
- Initial API call returns `{ "csrf_token": "..." }` or similar field
- Token value appears verbatim in a subsequent request header
- Often from session/config endpoints (e.g., `/api/session`, `/api/config`)

**Gotchas:**
- **Distinguish from exchange_chain:** exchange_chain produces a bearer/auth token; api_response produces a CSRF token paired with cookie_session.
- **Token rotation:** Some sites rotate the CSRF token per response. Always extract from the latest response.
- **Nested extraction:** Token may be deeply nested in response JSON -- classifier uses path matching.

---

## localStorage_jwt

**Detection:** localStorage key containing `JWT` or `token` with value starting with `eyJ` (base64 JWT prefix).

**Common signals:**
- localStorage keys like `jwtToken`, `access_token`, `auth_token`
- Value is a JWT (three dot-separated base64 segments)

**`app_path`:** When the token storage domain differs from the API domain, use `app_path` with an absolute URL. The resolver opens a temporary page to read localStorage, then closes it. Example: if the API is on `api.example.com` but tokens are stored in localStorage on `app.example.com`, set `app_path: https://app.example.com`.

**Gotchas:**
- JWT expiry -- check `exp` claim. Short-lived tokens need frequent refresh.

---

## sessionStorage_msal

**Detection:** sessionStorage key matching `msal.token.keys.*` pattern.

**Common signals:**
- Microsoft MSAL library stores tokens in sessionStorage
- Keys follow `msal.{clientId}.{key}` pattern

**Examples:** e.g. some Microsoft-based webmail (Graph API bearer token from MSAL cache)

---

## exchange_chain

**Detection:** POST to token-like endpoint that returns a bearer token used in subsequent requests.

**Common signals:**
- Step 1: Extract cookie or initial token from browser
- Step 2: POST to token endpoint -> receive bearer/access token
- Step 3: Use token in Authorization header

**Examples:**
- e.g. some social sites: cookie CSRF -> POST token endpoint -> bearer JWT -> API
- e.g. some AI chat apps: GET session endpoint -> access token (Cloudflare User-Agent binding)

**Gotchas:**
- **Multi-step chains:** Some sites have 2+ exchange steps (e.g., cookie -> intermediate token -> bearer JWT).
- **GET method:** Some exchange endpoints use GET, not POST. Check `method` field.
- **Cookie extraction:** Some chains start by reading a browser cookie (`extract_from: 'cookie'`), not an HTTP response.
- **Cloudflare UA binding:** If the site uses Cloudflare, the exchange step AND all subsequent API requests must send a User-Agent matching the browser session. Without this, Node.js fetch sends `undici` UA which Cloudflare rejects with 403.
- **Token cache bypass:** The token cache does not reconstruct exchange_chain auth from cache -- it falls through to session HTTP. Exchange_chain sites always need a live browser connection.

---

## webpack_module_walk

**Detection:** Token stored in webpack module cache, accessed via `webpackChunkXxx` global.

**Common signals:**
- Global variable matching `webpackChunk*`
- Token in module exports (often deeply nested)

**`app_path`:** Some SPAs only load the webpack bundle on authenticated app pages, not the landing page. Set `app_path` so the resolver auto-navigates when the cache is empty. Example: if a messaging app only loads token modules on the conversation page, set `app_path: /channels/@me` or similar.

**Export key convention:** Webpack minifies export names in production. The runtime checks keys in order: `default`, `Z`, `ZP`. The chunk global name is site-specific (e.g., `webpackChunk_app_name`).

---

## page_global

**Detection:** Auth data available as a page-level JavaScript global variable.

**Common signals:**
- `window.ytcfg`-style globals, `window.__NEXT_DATA__` (Next.js apps)
- Data accessible via `page.evaluate()`

**Examples:** e.g. some video platforms (global config object contains auth credentials for API calls)

**Alternative -- `const` schema fields:** When the page_global value is a public, stable key (not per-user/per-session), hardcode it as an OpenAPI schema `const` field instead. The `param-validator.ts` injects `const` values automatically, enabling `node` transport without an adapter. Use only when the key is truly public (not user-scoped).

---

## sapisidhash (Signing)

**Detection:** `SAPISIDHASH` in request headers. Specific to certain vendor properties.

**Common signals:**
- Header format: `<timestamp>_<sha1(timestamp + " " + sapisid + " " + origin)>`
- Requires `SAPISID`-style cookie + correct origin for SHA-1 computation

**Gotchas:**
- Requires both the SAPISID-style cookie AND the correct origin to compute the hash.

---

## custom_signing -- Not a Runtime Primitive

This is a **pattern** handled via adapter + page transport, not a configurable runtime primitive.

**Detection:** Query parameters like `X-Bogus`, `X-Gnarly`, `msToken` that change on every request and don't match any cookie or localStorage value.

**Common signals:**
- Parameters computed by obfuscated client-side JavaScript (often VM-based bytecode interpreters)
- Values change per-request, not per-session
- Cannot be reproduced outside the browser context

**Examples:**
- e.g. some social platforms: per-request transaction ID header, generated by webpack module, signature function takes `(host, path, method)`

**Gotchas:**
- Requires page transport with adapter extraction. Standard compile cannot handle.
- **Webpack signing functions:** When the signing function lives in a webpack module, it can be called via `require(moduleId).exportName(args)` from within `page.evaluate`. Module IDs are numeric and may change across deploys -- document how to re-find them.
