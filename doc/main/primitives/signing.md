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
