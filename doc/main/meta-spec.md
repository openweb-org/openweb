# Meta-spec: Type System & Validation

> `x-openweb` fields, primitive types, adapter contract, and schema validation.
> Last updated: 2026-04-21 (647c20c)

## Overview

The meta-spec is the contract between authored site packages and the runtime. It defines:

1. the OpenAPI/AsyncAPI extensions OpenWeb understands
2. the primitive families used for auth, CSRF, signing, pagination, and extraction
3. the `CustomRunner` contract for code-backed sites
4. the JSON Schema + AJV validation layer that rejects invalid specs early

TypeScript under `src/types/` is the source of truth. JSON Schema mirrors it for validation.

## `x-openweb` Extension Levels

### Server-level (`servers[].x-openweb`)

Applied once and inherited by all operations on that server.

```ts
interface XOpenWebServer {
  transport: 'node' | 'page'
  auth?: AuthPrimitive
  csrf?: CsrfPrimitive & { scope?: string[] }
  signing?: SigningPrimitive
  auth_check?: AuthCheckPrimitive
  headers?: Record<string, string>
  page_plan?: PagePlanConfig
  adapter?: AdapterRef
}
```

Key fields:

- `transport`: only `node` or `page`
- `auth` / `csrf` / `signing`: declarative request augmentation
- `auth_check`: body-shape rules for “HTTP 200 but actually logged out”
- `headers`: constant node-transport headers
- `page_plan`: default page acquisition rules
- `adapter`: default `CustomRunner` reference for operations under the server

### Operation-level (`paths[].{method}.x-openweb`)

Applied per operation and can override or disable server-level behavior.

```ts
interface XOpenWebOperation {
  permission?: 'read' | 'write' | 'delete' | 'transact'
  safety?: 'safe' | 'caution'
  requires_auth?: boolean
  build?: XOpenWebBuildMeta
  transport?: 'node' | 'page'
  auth?: AuthPrimitive | false
  csrf?: CsrfPrimitive | false
  signing?: SigningPrimitive | false
  auth_check?: AuthCheckPrimitive | false
  pagination?: PaginationPrimitive
  extraction?: ExtractionPrimitive
  adapter?: AdapterRef | false
  actual_path?: string
  unwrap?: string
  wrap?: string
  graphql_query?: string
  graphql_hash?: string
  page_plan?: PagePlanConfig
  verify_status?: 'ok' | 'requires_interactive_solve'
}
```

Important patterns:

- `auth: false`, `csrf: false`, `signing: false`, and `adapter: false` are explicit opt-outs
- `actual_path` lets the spec expose a logical path while sending a different wire path
- `wrap`, `graphql_query`, and `graphql_hash` shape GraphQL and APQ requests
- `verify_status: requires_interactive_solve` tells verify to skip CAPTCHA-gated ops

### Parameter-level (`parameters[].x-openweb`)

Used for derived wire values.

```ts
interface XOpenWebParameter {
  template?: string
}
```

`template` replaces `{paramName}` placeholders from the resolved caller input after defaults are applied. Templated params are derived, not caller-overridable. Template-source params that only exist to fill sibling templates are excluded from the outbound URL when they are not part of the path.

## Primitive Families

The runtime currently supports these declarative primitive families:

### Auth

- `cookie_session`
- `localStorage_jwt`
- `sessionStorage_msal`
- `page_global`
- `webpack_module_walk`
- `exchange_chain`

### CSRF

- `cookie_to_header`
- `meta_tag`
- `api_response`

### Signing

- `sapisidhash`

### Pagination

- `cursor`
- `link_header`

### Extraction

- `ssr_next_data`
- `html_selector`
- `script_json`
- `page_global_data`
- `response_capture`

`auth_check` is related but separate: it is not a discriminated “primitive type”; it is an array of body-shape rules used between parse/unwrap and schema validation.

Source of truth: `src/types/primitives.ts`

## Shared Injection Shape

Several primitives use the shared `Inject` shape:

```ts
interface Inject {
  header?: string
  prefix?: string
  query?: string
  json_body_path?: string
}
```

Not every primitive honors every field. For example, `json_body_path` is meaningful for `api_response`-style injection, while most auth primitives only use `header`, `prefix`, or `query`.

## `PagePlanConfig`

`PagePlanConfig` is part of the meta-spec because it is declared in the site package, not inferred at runtime:

```ts
interface PagePlanConfig {
  entry_url?: string
  ready?: string
  wait_until?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  settle_ms?: number
  warm?: boolean
  nav_timeout_ms?: number
  warm_origin?: 'page' | 'server' | string
}
```

Server- and operation-level page plans merge field-by-field. Operation values win even when falsy.

## GraphQL-Specific Fields

GraphQL is modeled as request shaping, not as a separate transport:

- `wrap`: usually `variables`
- `graphql_query`: literal query string when the runtime should inject it
- `graphql_hash`: persisted-query hash for Apollo/Relay APQ
- `unwrap`: often `data` or `0.data`

The runtime auto-selects GET vs POST APQ behavior from the HTTP method.

## `CustomRunner` Contract

The runtime contract for code-backed operations is:

```ts
interface CustomRunner {
  readonly name: string
  readonly description: string
  run(ctx: PreparedContext): Promise<unknown>
  warmReady?(page: Page): Promise<boolean>
  warmTimeoutMs?: number
}

interface PreparedContext {
  readonly page: Page | null
  readonly operation: string
  readonly params: Readonly<Record<string, unknown>>
  readonly helpers: AdapterHelpers
  readonly auth: AuthResult | undefined
  readonly serverUrl: string
}
```

`ctx.helpers` currently injects:

- `pageFetch`
- `graphqlFetch`
- `ssrExtract`
- `jsonLdExtract`
- `domExtract`
- `errors`

`nodeFetch` and `interceptResponse` are helper-library utilities, but they are not injected on `ctx.helpers`; source adapters import them directly from `src/lib/adapter-helpers.ts`, and `scripts/build-adapters.js` bundles them into the emitted adapter `.js`.

## Validation Model

Validation happens in two layers:

1. **schema construction** under `src/types/schema.ts` and `src/types/primitive-schemas.ts`
2. **AJV runtime validation** in `src/types/validator.ts`

Spec validation runs automatically during load (`loadOpenApi()`, `loadAsyncApi()`). Manifest validation runs when manifests are loaded or generated.

This catches:

- unknown or misspelled primitive types
- unsupported field placement
- invalid page-plan values
- malformed manifests

## Package Format

Runtime-loaded site packages use this shape:

```text
<site>/
├── openapi.yaml
├── asyncapi.yaml            # optional
├── manifest.json
├── DOC.md                   # optional notes surfaced by navigator
├── examples/
│   └── <operation>.example.json
└── adapters/
    └── <name>.js            # optional, compiled output
```

Source packages in `src/sites/<site>/` usually keep additional authoring files such as `SKILL.md` and `PROGRESS.md`.

## File Map

```text
src/types/
├── primitives.ts, ws-primitives.ts
├── extensions.ts, ws-extensions.ts
├── adapter.ts
├── manifest.ts
├── primitive-schemas.ts
├── schema.ts
└── validator.ts
```

## Related Docs

- [architecture.md](architecture.md)
- [runtime.md](runtime.md)
- [primitives/README.md](primitives/README.md)
- [adapters.md](adapters.md)
