# Security Model

> SSRF protection, redirect safety, error handling, and risk tiers.
> Last updated: 2026-04-03 (pre-release review)

## Overview

OpenWeb makes HTTP requests on behalf of agents. This creates SSRF risk — a malicious spec could direct requests to internal services. The security model ensures:

1. **Every outgoing URL is SSRF-validated** (DNS resolution + IP blocklist)
2. **Redirects are followed safely** (per-hop SSRF check, cross-origin header stripping)
3. **Errors are structured** (no stack traces leaked, retriable flag)
4. **Risk tiers** classify operations by danger level

---

## SSRF Protection

```typescript
async function validateSSRF(urlString: string): Promise<void>
// Throws on blocked URL
```

### Validation Steps

1. **Protocol check** — HTTPS only (HTTP rejected)
2. **DNS resolution** — Resolve hostname to IP addresses
3. **IP blocklist** — Check every resolved A/AAAA record

### Blocked IP Ranges

| Range | Description |
|-------|-------------|
| `0.0.0.0/8` | Current network |
| `10.0.0.0/8` | Private (Class A) |
| `100.64.0.0/10` | Shared address space (CGNAT) |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link-local |
| `172.16.0.0/12` | Private (Class B) |
| `192.168.0.0/16` | Private (Class C) |
| `169.254.169.254` | Cloud metadata (AWS, GCP, Azure) |
| `::1`, `::` | IPv6 loopback/unspecified |
| `fc00::/7` | IPv6 unique local |
| `fe80::/10` | IPv6 link-local |
| `::ffff:*` | IPv6-mapped IPv4 (re-checked against IPv4 blocklist) |

### Coverage

SSRF validation is enforced across all network paths:
- **HTTP executors**: `fetchWithRedirects()` calls `ssrfValidator` per hop
- **Browser-fetch executor**: validates before `page.evaluate(fetch(...))`
- **Node SSR executor**: validates before `fetch()`
- **Exchange chain steps**: validates each step URL
- **WebSocket connections**: `ws-runtime.ts` converts `wss://` → `https://` for DNS check before connecting
- **WS HTTP handshake**: validates handshake endpoint URL

-> See: `src/lib/ssrf.ts`

---

## Redirect Safety

All modes except `browser_fetch` follow redirects manually with safety checks:

```
HTTP 3xx
  │
  ├── Extract Location header
  ├── SSRF-validate redirect URL         ← blocks SSRF via redirect
  ├── Cross-origin?
  │     └── Strip Authorization, Cookie, X-* headers
  ├── 303 See Other?
  │     └── Rewrite method to GET, drop body
  ├── opaqueredirect?
  │     └── Stop chain, return as-is
  └── Max redirects? (5)
        └── Throw EXECUTION_FAILED
```

**Key protections:**
- **Per-hop SSRF:** Each redirect destination is validated, preventing SSRF-via-redirect attacks
- **Cross-origin header stripping:** Credentials don't leak to unexpected domains
- **303 rewrite:** POST→GET conversion per HTTP spec
- **Redirect limit:** Prevents infinite redirect loops

---

## browser_fetch Redirect Handling

In `browser_fetch` mode, redirects are delegated to the browser's network stack. Only the **initial URL** is SSRF-validated. The browser handles the rest, which is safe because:
- The browser is already running in the user's context
- The browser enforces its own security model (CORS, same-origin, etc.)

---

## Error Model

All errors are wrapped in `OpenWebError` with a structured payload:

```typescript
interface OpenWebErrorPayload {
  readonly error: 'execution_failed' | 'auth'
  readonly code: OpenWebErrorCode
  readonly message: string
  readonly action: string        // Which operation failed
  readonly retriable: boolean
  readonly failureClass: FailureClass
  readonly retryAfter?: string
}

type OpenWebErrorCode =
  | 'EXECUTION_FAILED'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'AUTH_FAILED'
```

### Error Flow

```
Runtime error
  │
  ├── toOpenWebError()     Convert any error to OpenWebError
  ├── writeErrorToStderr() Write JSON payload to stderr
  └── process.exit(1)      CLI exits with error code
```

**Design decisions:**
- JSON to stderr (not stdout) — agents can parse errors separately from results
- `retriable` flag — agents can decide whether to retry
- No stack traces in payload — security (prevents information leakage)

-> See: `src/lib/errors.ts`, [runtime.md](runtime.md) — failure classification and status mapping

---

## Parameter Validation

Input parameters are validated before execution:

| Check | Behavior |
|-------|----------|
| Required params missing | Throw `INVALID_PARAMS` |
| Unknown params provided | Throw `INVALID_PARAMS` |
| Type mismatch | Throw `INVALID_PARAMS` |
| Default values | Applied for optional params |

Response schema validation is also performed when a schema is defined in the OpenAPI spec, but failures are non-fatal (reported in `responseSchemaValid` field).

---

## File Structure

```
src/lib/
├── ssrf.ts             # SSRF validation (IPv4/v6, DNS, metadata)
├── errors.ts           # OpenWebError, structured error contract
├── openapi.ts          # OpenAPI parsing, URL building
├── site-resolver.ts    # Site resolution (bundled + user-installed)
├── spec-loader.ts      # Spec loading + validation
└── permissions.ts      # Permission system + derivation
```

---

## Adapter Sandboxing

Site packages can include JavaScript adapters that run with **full Node.js privileges** — file system access, network requests, and browser control via CDP. There is no sandbox or capability restriction on adapter code. Users should only install site packages from trusted sources. The bundled sites ship with the package and are reviewed; user-installed site packages are not.

---

## Known Limitations

### DNS Rebinding (TOCTOU)

The SSRF validator resolves DNS and checks resolved IPs against private ranges, but the subsequent HTTP request resolves DNS independently. A malicious DNS server could return a public IP during validation and a private IP during the actual request. This is a known TOCTOU gap in v0.1. The practical risk is minimal: all server URLs originate from site package specs (trusted code, not user input), so an attacker would need to compromise a site package to exploit this.

---

## Related Docs

- [runtime.md](runtime.md) — How security checks are invoked during execution
- [architecture.md](architecture.md) — System overview
- `src/lib/ssrf.ts` — SSRF implementation
