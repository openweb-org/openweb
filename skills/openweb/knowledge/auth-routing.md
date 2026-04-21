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
| Static token found in `webpackChunk*` module cache (e.g., Discord) | webpack_module_walk | Auth |
| Auth data in JS global variable (e.g., `window.ytcfg`-style) | page_global | Auth |
| `SAPISIDHASH` in request headers | sapisidhash | Signing |
| Per-request computed params (X-Bogus, x-client-transaction-id) that don't match any stored value | custom_signing | Pattern (adapter) |

> **webpack distinction:** `webpack_module_walk` extracts a **static token** from the chunk cache (e.g., Discord's bearer token). When webpack lookup is used to discover a **per-request signing function** (e.g., X's `x-client-transaction-id` generator), classify it as `custom_signing` adapter pattern, not auth primitive — the webpack walk is an implementation detail of the signer, not the auth source.

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

## Body-Wrapped Auth Errors (`auth_check`)

Some sites return HTTP 200 with an application-level "unauthenticated" payload (no 401/403). Without help, the runtime treats the body as a schema/value drift instead of `needs_login`, so the auth cascade never fires.

Declare the shape under `x-openweb.auth_check` on the server entry (or override per-op). Rules are OR'd; any match throws `needs_login` between body parse and schema validation.

```yaml
servers:
  - url: https://xueqiu.com
    x-openweb:
      transport: node
      auth: { type: cookie_session }
      auth_check:
        - path: error_code
          equals: "60201"           # canonical xueqiu "invalid user id"
        - path: message
          contains: "login"          # case-insensitive substring fallback
```

Rule shape: `{ path?: dotted, equals?: string|number, contains?: string }`. Omit `path` to match against the body itself (bare-string error bodies). Op-level `auth_check: false` disables server-level rules for that op.

When to add: the site's "logged-out read" returns HTTP 200 with a stable error code or message. Capture the no-cookie response, identify the discriminating field, encode it as a single rule.

## Request-Shape Misdiagnosis (`needs_login` ≠ auth failure)

When `verify` reports `needs_login`, `auth_expired`, or 429 on an op the user can perform manually in real Chrome, the root cause is **almost always a request-shape diff** — missing client-token header, wrong endpoint, stale GraphQL hash, or absent SPA bot-mitigation headers — **not** account quota or cookie/auth state.

- **Detection signals:** standalone `pnpm dev <site> exec <op>` reproduces the failure with a freshly-warmed browser; the user can do the same action by clicking in real Chrome; cookies in the managed profile are valid (other ops on the same site PASS).
- **Why the misdiagnosis happens:** `src/lib/errors.ts:getHttpFailure(401|403|timeout)` maps every auth-shaped HTTP failure into `needs_login`, which triggers `handleLoginRequired() → refreshProfile()`. The cascade looks like an auth bug because the symptom is "browser opens for re-login."
- **Action:** before touching auth or cookies, diff the request the SPA actually sends (DevTools → Network → Copy as fetch) against what the adapter sends. Look for: missing `client-token` / `x-csrf-token` / `x-super-properties` / `wm_qos.correlation_id` style headers; dead REST endpoint that's been migrated to GraphQL; persisted-query hash that's rotated. Run a probe script (`scripts/probe-<site>.ts`) to A/B the live shape against the recorded one.
- **Examples (2026-04-20 handoff5):**
  - `spotify` (commit `a1831bb`) — like/unlike misclassified as 429 quota; real cause was wrong pathfinder operationName + missing client-token.
  - `walmart` (commit `46dd46e`) — `removeFromCart` misclassified as per-account 429 quota; real cause was missing SPA bot-mitigation headers (`x-o-platform-version`, `tenant-id`, `traceparent`, `wm_qos.correlation_id`) on `orchestra/*` calls.
  - `x` (commit `b734164`) — `hideReply`/`unhideReply` misclassified as login-loop; real cause was the legacy REST `PUT /i/api/2/tweets/{id}/hidden` endpoint had been removed (hangs 45 s) and the SPA now uses GraphQL `ModerateTweet`.
  - `youtube` (in-flight) — `addComment`/`deleteComment` misclassified as auth/quota; real cause distinct here (account-level shadowban surfaced by InnerTube `comment/create_comment` 200 with `Comment failed to post.` payload), but the same surface symptom of "verify says auth, manual works."

If a single fix turns a "permanent quota" or "permanent login loop" into a clean PASS, the diagnosis was always wrong. Update both the site DOC.md and any op-level `auth_check` rule so the next agent sees the real signature, not the cascade output.

## Profile-Snapshot Coverage (`copyProfileSelective`)

`browser start` snapshots the user's Chrome profile into `mkdtemp` so it can launch a clean instance with the same auth state. Earlier the snapshot used a tight allowlist (`Cookies`, `Web Data`, `Preferences`, `Local/Session Storage`, `IndexedDB`). That missed several files Chrome consults during sign-in propagation:

- `Account Web Data` — GAIA account metadata for signed-in profiles.
- `Sync Data/` — account sync state; Chrome can mark the profile as signed-out without it.
- `Trust Tokens`, `TransportSecurity`, `Network Persistent State` — TLS/origin-state Chrome expects to be present for an established profile.
- Root-level `First Run` / `Last Version` — without these Chrome treats the user-data-dir as a fresh install and may re-initialise GAIA, dropping first-party Google auth cookies.

The snapshot is now **copy-everything-minus-blocklist** (caches, `History`, `Sessions`, `Login Data`, locks, macOS `.com.google.Chrome.*` xattr sidecars). Marginally larger (~tens of MB), considerably more robust.

**Important diagnostic note — "missing first-party SAPISID" was misleading.** SAPISID/SID/HSID/SSID are set on `.google.com`, not `.youtube.com`. They are present in the source `Cookies` SQLite even with the old allowlist. So a YouTube 401 with `LOGGED_IN: true` and only `LOGIN_INFO` returned for `https://www.youtube.com` is not necessarily a snapshot bug — it can be an adapter scope bug where `page.context().cookies('https://www.youtube.com')` is queried instead of also asking for `.google.com`. Verify by calling browser-level `Storage.getCookies` (no URL filter) before assuming the snapshot is broken.
