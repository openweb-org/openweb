# Signing, CSRF, and Bot Detection Primitives

> Primitives for CSRF protection, per-request signing, and related patterns.

---

## CSRF Primitives

CSRF primitives extract anti-forgery tokens. Only resolved for **mutations** (POST, PUT, PATCH, DELETE).

| Type | What it does | Implemented |
|------|-------------|-------------|
| `cookie_to_header` | Read cookie value -> set as header | Yes |
| `meta_tag` | Read `<meta>` tag content -> set as header | Yes |
| `api_response` | Call CSRF endpoint, extract token -> set as header | Yes |

### scope (optional)

All CSRF primitives accept an optional `scope?: readonly string[]` field that limits resolution to specific HTTP methods. Defined as `CsrfPrimitive & { readonly scope?: readonly string[] }` in `src/types/extensions.ts` and enforced by `shouldApplyCsrf()` in `src/runtime/cache-manager.ts`. Typical value:

```yaml
csrf:
  type: cookie_to_header
  cookie: "csrftoken"
  header: "X-CSRFToken"
  scope: ["POST", "PUT", "PATCH", "DELETE"]
```

Omit `scope` to apply on every mutation (the default behavior). Use it when a site requires CSRF on a narrower or unusual subset of methods.

### cookie_to_header

Classic CSRF pattern. Reads a cookie and injects it as a header.

```yaml
csrf:
  type: cookie_to_header
  cookie: "csrftoken"
  header: "X-CSRFToken"
```

-> See: `src/runtime/primitives/cookie-to-header.ts`

### meta_tag

Reads a `<meta>` element's `content` attribute from the DOM.

```yaml
csrf:
  type: meta_tag
  name: "csrf-token"
  header: "X-CSRF-Token"
```

Used by GitHub.

-> See: `src/runtime/primitives/meta-tag.ts`

### api_response

Calls a CSRF endpoint and extracts the token from the JSON response.

```yaml
csrf:
  type: api_response
  endpoint: "/api/csrf"
  method: GET
  extract: "token"
  inject: { header: "X-CSRF-Token" }
```

The token fetch runs **inside `page.evaluate(fetch)`** so any rotated cookies in the `Set-Cookie` response stay coherent with the browser jar. A node-side fetch would orphan the rotated cookies — the next API call would present the new CSRF token alongside stale cookies and 401. Only meaningful for `transport: page` ops; node-transport ops fall back to the legacy node fetch via injected `fetchImpl`.

**`endpoint` resolution.** The `endpoint` value is passed directly to `fetch()` — `src/runtime/primitives/api-response.ts` does not resolve it against `serverUrl`. A relative path like `/api/csrf` therefore resolves against whatever origin the browser page is currently on; it only works when the page context is already on the right origin (the common case for `transport: page`). Use an absolute URL (`https://example.com/api/csrf`) when the CSRF endpoint lives on a different origin than the active page or when you want the resolution to be unambiguous.

-> See: `src/runtime/primitives/api-response.ts`

---

## Signing Primitives

Signing primitives compute **per-request** signatures. Resolved on every request (not just mutations).

| Type | What it does | Implemented |
|------|-------------|-------------|
| `sapisidhash` | Compute YouTube-style SAPISIDHASH from cookie + origin + timestamp | Yes |

### sapisidhash

YouTube's proprietary request signing:

```yaml
signing:
  type: sapisidhash
  cookie: "SAPISID"
  origin: "https://www.youtube.com"
  inject: { header: "Authorization", prefix: "SAPISIDHASH " }
```

Computes: `SHA1(timestamp + " " + sapisidValue + " " + origin)` -> `timestamp_hash`

-> See: `src/runtime/primitives/sapisidhash.ts`

---

## Related Docs

- [README.md](README.md) — Primitive overview, taxonomy, and resolution pipeline
- [auth.md](auth.md) — Auth primitives (cookie_session, localStorage_jwt, etc.)
