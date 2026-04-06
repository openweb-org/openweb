# Meta-spec: Type System & Validation

> L2 primitive types, x-openweb extensions, JSON Schema, and AJV validation.
> Last updated: 2026-03-26 (M38)

## Overview

The meta-spec is the type system that drives everything in OpenWeb. It defines:
1. **L2 primitive types** — 16 discriminated union types for auth/CSRF/signing/pagination/extraction
2. **x-openweb extensions** — Server-level and operation-level OpenAPI extensions
3. **JSON Schema** — Machine-readable schema for validation
4. **Validation** — AJV-based validation of specs and manifests

All types are formalized as TypeScript (source of truth) + JSON Schema (for AJV validation).

-> See: `src/types/`

---

## x-openweb Extensions

OpenWeb extends OpenAPI 3.1 with `x-openweb` at two levels:

### Server-Level (XOpenWebServer)

```typescript
interface XOpenWebServer {
  transport: 'node' | 'page'
  auth?: AuthPrimitive
  csrf?: CsrfPrimitive & { scope?: string[] }
  signing?: SigningPrimitive
}
```

> **Note:** WebSocket dispatch is not a `transport` value. WS operations are triggered by the presence of an AsyncAPI spec, not the transport field.

Applied to the **server** object — shared across all operations:

```yaml
servers:
  - url: https://api.instagram.com
    x-openweb:
      transport: node
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
```

### Operation-Level (XOpenWebOperation)

```typescript
interface XOpenWebOperation {
  permission?: 'read' | 'write' | 'delete' | 'transact'
  safety?: 'safe' | 'caution'
  requires_auth?: boolean
  build?: {
    stable_id?: string
    signature_id?: string
    tool_version?: number
    verified?: boolean
    signals?: string[]
  }
  transport?: Transport             // Override server transport
  auth?: AuthPrimitive | false      // Override server auth (false to disable)
  csrf?: CsrfPrimitive | false     // Override server CSRF (false to disable)
  signing?: SigningPrimitive | false // Override server signing (false to disable)
  pagination?: PaginationPrimitive
  extraction?: ExtractionPrimitive
  adapter?: AdapterRef
  actual_path?: string              // Real URL path when spec key is virtual (e.g. GraphQL dedup)
}
```

Applied to individual operations:

```yaml
paths:
  /api/v1/feed/timeline:
    get:
      operationId: getTimeline
      x-openweb:
        permission: read
        build:
          stable_id: instagram_getTimeline_v1
        pagination:
          type: cursor
          response_field: next_max_id
          request_param: max_id
```

-> See: `src/types/extensions.ts`

---

## L2 Primitive Type Catalog

16 types organized into 5 categories. Each is a **discriminated union** on the `type` field.

### Auth (6 types)

| Type | Description | Key config |
|------|-------------|------------|
| `cookie_session` | Browser cookies | (none) |
| `localStorage_jwt` | JWT from localStorage | `key`, `path`, `inject` |
| `sessionStorage_msal` | MSAL token from sessionStorage | `key_pattern`, `scope_filter`, `token_field`, `inject` |
| `page_global` | Window global expression | `expression`, `inject`, `values[]` |
| `webpack_module_walk` | Webpack module cache walk | `chunk_global`, `module_test`, `call`, `app_path?`, `inject` |
| `exchange_chain` | Multi-step token exchange | `steps[]`, `inject` |

### CSRF (3 types)

| Type | Description | Key config |
|------|-------------|------------|
| `cookie_to_header` | Cookie value → header | `cookie`, `header` |
| `meta_tag` | DOM meta tag → header | `name`, `header` |
| `api_response` | CSRF endpoint → header | `endpoint`, `extract`, `inject` |

### Signing (1 type)

| Type | Description | Key config |
|------|-------------|------------|
| `sapisidhash` | YouTube SAPISIDHASH | `cookie`, `origin`, `inject` |

### Pagination (2 types)

| Type | Description | Key config |
|------|-------------|------------|
| `cursor` | Cursor-based | `response_field`, `request_param`, `has_more_field`, `items_path` |
| `link_header` | HTTP Link header | `rel` |

`response_field` and `request_param` accept **dotted paths** for nested JSON structures (e.g., `data.actor.entitySearch.results.nextCursor` for reading, `variables.cursor` for writing into GraphQL request bodies).

### Extraction (4 types)

| Type | Description | Key config |
|------|-------------|------------|
| `ssr_next_data` | Next.js SSR data | `page_url`, `path` |
| `html_selector` | CSS selector | `page_url`, `selectors`, `attribute`, `multiple` |
| `script_json` | Script tag JSON | `selector`, `path` |
| `page_global_data` | Window global | `page_url`, `expression`, `path`, `adapter`, `method` |

-> See: `src/types/primitives.ts` — full TypeScript definitions

---

## Inject Schema

Primitives that inject values into requests use the shared `Inject` interface:

```typescript
interface Inject {
  header?: string       // HTTP header name
  prefix?: string       // Value prefix (e.g., "Bearer ")
  query?: string        // Query parameter name
  json_body_path?: string   // Body field at JSON path
}
```

---

## JSON Schema

Every type has a parallel JSON Schema definition for AJV validation:

```
TypeScript types (src/types/primitives.ts)     ← source of truth
       ↓ manually mirrored
JSON Schema (src/types/primitive-schemas.ts)    ← AJV validation
       ↓
Composite schema (src/types/schema.ts)          ← server + operation + manifest
```

-> See: `src/types/primitive-schemas.ts`, `src/types/schema.ts`

---

## Validation

AJV validates two things. Spec validation runs automatically at load time (`loadOpenApi()`) so unsupported auth types and unknown fields are caught before reaching runtime.

### 1. x-openweb Spec Validation

```typescript
validateXOpenWebSpec(spec: object): ValidationResult
```

Validates server-level `x-openweb` (transport, auth, CSRF, signing) and operation-level `x-openweb` (permission, pagination, extraction, adapter).

### 2. Manifest Validation

```typescript
validateManifest(manifest: object): ValidationResult
```

Validates `manifest.json` structure (name, version, spec_version, etc.).

```typescript
interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

interface ValidationError {
  path: string
  message: string
}
```

-> See: `src/types/validator.ts`

---

## Skill Package Format

A compiled skill package contains:

```
sites/<site>/
├── openapi.yaml          # L1 spec + x-openweb L2 extensions
├── asyncapi.yaml         # AsyncAPI 3.0 for WS channels (optional)
├── manifest.json         # Package metadata
├── adapters/             # L3 code (optional)
│   └── <name>.js
└── examples/
    └── <operationId>.example.json
```

### manifest.json

```json
{
  "name": "instagram",
  "display_name": "Instagram",
  "version": "1.0.0",
  "spec_version": "2.0",
  "site_url": "https://www.instagram.com",
  "requires_auth": true,
  "stats": { "operation_count": 3, "l1_count": 0, "l2_count": 3, "l3_count": 0, "ws_count": 0 }
}
```

-> See: `src/types/manifest.ts`

---

## File Structure

```
src/types/
├── primitives.ts          # 16 L2 primitive discriminated unions
├── primitive-schemas.ts   # JSON Schema mirrors for AJV
├── extensions.ts          # XOpenWebServer, XOpenWebOperation, Transport, RequestEncoding, XOpenWebBuildMeta, RiskTier
├── adapter.ts             # CodeAdapter interface
├── manifest.ts            # Manifest type
├── schema.ts              # Composite JSON Schema (server + operation + manifest)
├── validator.ts           # AJV validation (validateXOpenWebSpec, validateManifest)
└── index.ts               # Re-exports
```

---

## Related Docs

- [architecture.md](architecture.md) — Where meta-spec fits
- [primitives/](primitives/README.md) — How primitives are resolved at runtime
- [adapters.md](adapters.md) — L3 CodeAdapter interface
- [compiler.md](compiler.md) — How specs are generated
- `src/types/primitives.ts` — Full L2 type definitions
