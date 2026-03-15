# Skill Package Format v2

> **Status**: DRAFT
> **Evolved from**: v1 (`archive/v1/`)
> **Consumed by**: Runtime executor, CLI, self-healing

## Package Layout

A skill package is a self-contained directory with everything needed to
discover, execute, and test a site's API tools.

```
bluesky/
├── manifest.json           # Package metadata + fingerprint
├── openapi.yaml            # L1 endpoints + L2 primitives (x-openweb)
├── asyncapi.yaml           # L1 WebSocket/SSE channels (optional)
├── adapters/               # L3 code adapters (optional)
│   └── *.ts
└── tests/
    └── smoke.test.ts       # Per-operation regression tests
```

### What's NOT in the Package

- **No capture bundle**: `capture/` is compiler input, not shipped
- **No `patterns.yaml`**: L2 primitives live inside `openapi.yaml` as `x-openweb`
- **No `extractors/`**: v1 CSRF extractors are replaced by L2 primitives
- **No MCP/SKILL.md**: Agent-specific formats generated on demand by CLI

---

## manifest.json

Package metadata that OpenAPI cannot express.

```json
{
  "name": "bluesky",
  "display_name": "Bluesky",
  "version": "1.0.0",
  "spec_version": "2.0",
  "compiled_at": "2026-03-15T10:00:00Z",
  "compiler_version": "0.2.0",
  "site_url": "https://bsky.social",
  "description": "Bluesky social network — AT Protocol XRPC API",
  "fingerprint": {
    "js_bundle_hash": "a1b2c3d4e5f6",
    "api_endpoint_set_hash": "f6e5d4c3b2a1",
    "response_shape_hash": "1a2b3c4d5e6f",
    "last_validated": "2026-03-15T10:00:00Z"
  },
  "dependencies": {
    "getTimeline": ["getProfile"],
    "likePost": ["getTimeline"]
  },
  "stats": {
    "operation_count": 15,
    "l1_count": 15,
    "l2_count": 15,
    "l3_count": 0
  }
}
```

**Fields**:

| Field | Purpose |
|---|---|
| `name` | Package identifier (directory name) |
| `version` | SemVer, incremented on recompilation |
| `spec_version` | OpenWeb spec format version (`"2.0"`) |
| `compiled_at` | When the compiler produced this package |
| `fingerprint` | Hashes for detecting site changes (self-healing) |
| `dependencies` | Operation dependency graph (A needs data from B) |
| `stats` | Quick summary of layer distribution |

---

## openapi.yaml

Standard OpenAPI 3.1 with `x-openweb` vendor extensions. This is the
**single source of truth** for all operations, schemas, and runtime config.

### Server-Level x-openweb

L2 primitives that apply to all operations under a server:

```yaml
openapi: 3.1.0
info:
  title: Instagram API
  version: "1.0"
  x-openweb:
    spec_version: "2.0"
servers:
  - url: https://www.instagram.com/api/v1
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
```

### Operation-Level x-openweb

Per-operation metadata: risk tier, pagination, extraction, adapter reference.

```yaml
paths:
  /feed/timeline/:
    get:
      operationId: getTimeline
      summary: Get the authenticated user's feed
      x-openweb:
        risk_tier: safe
        stable_id: "a1b2c3d4"
        tool_version: 1
        verified: true
        signals: ["status-match", "verified"]
        pagination:
          type: cursor
          response_field: next_max_id
          request_param: max_id
      parameters:
        - name: max_id
          in: query
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TimelineResponse'
```

### x-openweb Schema Reference

Full TypeScript types in [layer2-interaction-primitives.md](layer2-interaction-primitives.md).
Summary of all `x-openweb` fields:

**Server-level** (`servers[].x-openweb`):
```yaml
x-openweb:
  mode: direct_http | session_http | browser_fetch
  auth: AuthPrimitive          # see L2 spec
  csrf: CsrfPrimitive          # see L2 spec
  signing: SigningPrimitive     # see L2 spec
```

**Operation-level** (`paths[].{method}.x-openweb`):
```yaml
x-openweb:
  risk_tier: safe | low | medium | high | critical
  stable_id: string            # SHA256(method + host + path)[:8]
  signature_id: string         # SHA256(method + host + path + params)[:8]
  tool_version: integer        # incremented on breaking changes
  verified: boolean            # was this probed during compilation?
  signals: string[]            # evidence array (e.g., ["status-match"])
  mode: string                 # override server-level mode
  csrf: CsrfPrimitive          # override server-level CSRF
  pagination: PaginationPrimitive
  extraction: ExtractionPrimitive
  adapter:                     # L3 adapter reference
    name: string               # adapter filename (without .ts)
    operation: string           # function to call
    params: object             # static params to pass
```

---

## asyncapi.yaml (Optional)

Present only for sites with WebSocket or SSE APIs. Standard AsyncAPI 3.x.

```yaml
asyncapi: 3.0.0
info:
  title: Discord Gateway
  version: "10"
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
    messages:
      identify:
        payload:
          type: object
          properties:
            op: { type: integer, const: 2 }
            d:
              type: object
              properties:
                token: { type: string }
                intents: { type: integer }
```

See [browser-integration.md](browser-integration.md) for AsyncAPI usage.

---

## adapters/ Directory (Optional)

L3 code adapter files. Present only for sites that need code escape hatches.

```
adapters/
├── onlyfans-signing.ts      # obfuscated request signing
├── telegram-protocol.ts     # MTProto via apiManager
└── whatsapp-modules.ts      # internal require() access
```

Each file exports a `CodeAdapter` object. See [layer3-code-adapters.md](layer3-code-adapters.md)
for the interface spec.

**Naming convention**: `{site}-{capability}.ts` (e.g., `onlyfans-signing.ts`).

**Bundling**: Adapters are TypeScript source files, compiled at package install
time. No pre-bundled JS — keeps packages auditable and diffable.

---

## tests/ Directory

Per-operation smoke tests generated by the compiler.

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { execute } from '@openweb/runtime';

describe('bluesky', () => {
  it('getTimeline returns valid response', async () => {
    const result = await execute('bluesky', 'getTimeline', { limit: 5 });
    expect(result).toHaveProperty('feed');
    expect(Array.isArray(result.feed)).toBe(true);
  });

  it('getProfile returns valid response', async () => {
    const result = await execute('bluesky', 'getProfile', {
      actor: 'did:plc:example',
    });
    expect(result).toHaveProperty('handle');
    expect(result).toHaveProperty('displayName');
  });
});
```

Tests verify **response shape**, not exact values. They serve as regression
tests — if a site changes its API, tests fail and trigger recompilation.

---

## Full Package Examples

### Bluesky (L2 only — localStorage_jwt + cursor pagination)

```
bluesky/
├── manifest.json
├── openapi.yaml
└── tests/
    └── smoke.test.ts
```

No `asyncapi.yaml` (no WebSocket). No `adapters/` (no L3).

### Discord (L2 + AsyncAPI)

```
discord/
├── manifest.json
├── openapi.yaml          # REST API v9
├── asyncapi.yaml         # Gateway WebSocket
└── tests/
    └── smoke.test.ts
```

### WhatsApp (L3 dominant)

```
whatsapp/
├── manifest.json
├── openapi.yaml          # virtual endpoints (mapped to adapter calls)
├── adapters/
│   └── whatsapp-modules.ts
└── tests/
    └── smoke.test.ts
```

WhatsApp's `openapi.yaml` defines virtual paths that map entirely to L3:

```yaml
paths:
  /internal/chats:
    get:
      operationId: getChats
      x-openweb:
        mode: browser_fetch
        risk_tier: safe
        adapter:
          name: whatsapp-modules
          operation: getChats
```

### Costco (Multi-domain L2)

```
costco/
├── manifest.json
├── openapi.yaml
└── tests/
    └── smoke.test.ts
```

Multiple servers in `openapi.yaml`, each with different auth:

```yaml
servers:
  - url: https://www.costco.com
    x-openweb:
      mode: session_http
      auth: { type: cookie_session }
  - url: https://api.digital.costco.com
    x-openweb:
      mode: session_http
      auth:
        type: sessionStorage_token
        key: "authToken_${cookie:hashedUserId}"
        inject: { header: Authorization, prefix: "Bearer " }
  - url: https://ecom-api.costco.com
    x-openweb:
      mode: direct_http
      auth: { type: cookie_session }
```

---

## Package Discovery

The CLI discovers packages from a configured directory:

```bash
# Default: ~/.openweb/skills/
ls ~/.openweb/skills/
# bluesky/  discord/  instagram/  whatsapp/  ...

openweb sites
# bluesky     Bluesky social network — AT Protocol XRPC API
# discord     Discord — REST API v9 + Gateway WebSocket
# instagram   Instagram — Private API v1
# whatsapp    WhatsApp Web — Internal protocol access
```

Packages can also be installed from a registry (future):
```bash
openweb install bluesky
```

---

## Version Management

### Package Version (`manifest.json`)

Incremented on every recompilation. SemVer:
- **Patch**: Response schema changed (non-breaking)
- **Minor**: New operations added
- **Major**: Operations removed or breaking parameter changes

### Tool Version (`x-openweb.tool_version`)

Per-operation integer. Incremented when:
- Parameters change (added/removed/renamed)
- Response shape changes incompatibly
- Endpoint URL changes

### Fingerprint

Composite hash for detecting site changes without recompilation:
- `js_bundle_hash`: SHA256 of main JS bundle URLs
- `api_endpoint_set_hash`: SHA256 of sorted endpoint paths
- `response_shape_hash`: SHA256 of response schema set

If any hash changes, the CLI flags the package for recompilation.

---

## Cross-References

- **L2 x-openweb schema** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md)
- **L3 adapter interface** → [layer3-code-adapters.md](layer3-code-adapters.md)
- **AsyncAPI usage** → [browser-integration.md](browser-integration.md)
- **Compiler output** → [compiler-pipeline.md](compiler-pipeline.md): Phase 4 produces skill packages
- **Runtime consumption** → [runtime-executor.md](runtime-executor.md)
