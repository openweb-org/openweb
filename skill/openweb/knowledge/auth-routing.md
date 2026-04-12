# Auth Routing

Quick lookup: site signals -> expected auth family -> which section of [auth-primitives.md](auth-primitives.md) to read.

> Archetype docs may use high-level labels (e.g., `oauth2`, `bearer_token`) that map to one of the primitives below. Example: `oauth2` often manifests as `exchange_chain`, `localStorage_jwt`, or `sessionStorage_msal` in captured browser traffic.

## Signal -> Auth Primitive

| Signal in Captured Traffic | Primitive | Category |
|---|---|---|
| Session cookies correlated across requests (names like `session`, `sid`, `token`, `auth`) | cookie_session | Auth |
| Cookie value appears verbatim as request header value (e.g., `ct0` -> `x-csrf-token`) | cookie_to_header | CSRF |
| `<meta name="csrf-token">` content matches request header | meta_tag | CSRF |
| JSON response body field appears as request header on subsequent calls | api_response | CSRF |
| localStorage key with JWT value (`eyJ...`) | localStorage_jwt | Auth |
| sessionStorage key matching `msal.token.keys.*` | sessionStorage_msal | Auth |
| POST to token endpoint returns bearer token used in subsequent requests | exchange_chain | Auth |
| Token found in `webpackChunk*` module cache | webpack_module_walk | Auth |
| Auth data in JS global variable (e.g., `window.ytcfg`-style) | page_global | Auth |
| `SAPISIDHASH` in request headers | sapisidhash | Signing |
| Per-request computed params (X-Bogus, x-client-transaction-id) that don't match any stored value | custom_signing | Pattern (adapter) |

## Per-Operation Override

Auth, CSRF, and signing are normally site-level. Individual operations can override or disable by setting `auth: false`, `csrf: false`, or `signing: false` in their `x-openweb` block. Use for genuinely public operations on otherwise authenticated sites (health checks, public search, category listings).

## No Auth Detected

If the analyzer detects no auth primitive:
1. Site may genuinely be public (most data API site packages)
2. Capture may be missing authenticated traffic -- was the user logged in during capture?
3. Site may use an unsupported auth pattern -- check for bearer tokens in headers, OAuth redirects

## Quick Decision Flow

```text
Does the site need auth at all?
  ├─ No (public API) -> no auth config needed
  └─ Yes -> What signal is in the traffic?
       ├─ Session cookies -> cookie_session (+ check for CSRF)
       ├─ JWT in storage -> localStorage_jwt or sessionStorage_msal
       ├─ Token exchange flow -> exchange_chain
       ├─ Token in webpack -> webpack_module_walk
       ├─ Token in JS global -> page_global
       └─ SAPISIDHASH in headers -> sapisidhash signing
```

For detailed detection, config, and gotchas per primitive -> [auth-primitives.md](auth-primitives.md)
