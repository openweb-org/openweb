import type {
  AuthCheckPrimitive,
  AuthPrimitive,
  CsrfPrimitive,
  ExtractionPrimitive,
  PaginationPrimitive,
  SigningPrimitive,
} from './primitives.js'

export type PermissionCategory = 'read' | 'write' | 'delete' | 'transact'

export type Transport = 'node' | 'page'

export type PageWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'

/** Declarative page-acquisition plan. Fields are independently mergeable from
 *  server → operation (see resolvePagePlan in operation-context). */
export interface PagePlanConfig {
  readonly entry_url?: string
  readonly ready?: string
  readonly wait_until?: PageWaitUntil
  readonly settle_ms?: number
  readonly warm?: boolean
  readonly nav_timeout_ms?: number
  /** Target origin for warmSession. 'page' warms on entry_url (keep current
   *  page — required when adapter auth reads page globals on a different
   *  origin than the API server). 'server' warms on serverUrl. Explicit URL
   *  warms on that URL. Default: entry_url when its origin differs from
   *  serverUrl, otherwise serverUrl. */
  readonly warm_origin?: 'page' | 'server' | string
}

// Parameter-level x-openweb (on operation parameters[])
export interface XOpenWebParameter {
  /** Template literal for this parameter's wire value. `{name}` placeholders
   *  are substituted from caller input (or other parameter defaults) at
   *  request-build time. Callers cannot override a templated parameter.
   *  Example: `tags` with template `story,author_{id}` → when caller passes
   *  `{id: "pg"}`, the emitted value becomes `story,author_pg`. */
  readonly template?: string
  /** User-friendly alias for an opaque wire-name param. Callers can use the
   *  alias instead of the wire name; it's resolved before validation. The wire
   *  name still drives the HTTP request. */
  readonly alias?: string
}

export interface AdapterRef {
  readonly name: string
  readonly operation: string
  readonly params?: Readonly<Record<string, unknown>>
}

// Server-level x-openweb (on servers[] entries)
export interface XOpenWebServer {
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive & { readonly scope?: readonly string[] }
  readonly signing?: SigningPrimitive
  /** Body-shape patterns that signal "unauthenticated despite HTTP 200".
   *  Applied between body parse/unwrap and schema validation. Any matching
   *  rule synthesizes a `needs_login` failure so the auth cascade can recover. */
  readonly auth_check?: AuthCheckPrimitive
  /** Constant headers merged into every node-transport request to this server.
   *  Useful for per-site User-Agent overrides, API keys, etc. */
  readonly headers?: Readonly<Record<string, string>>
  /** Default page-acquisition plan for page-transport operations. */
  readonly page_plan?: PagePlanConfig
  /** Default adapter reference for operations under this server. Individual
   *  operations can override with their own `adapter: AdapterRef`, or opt out
   *  with `adapter: false`. `operation` and `params` here act as defaults when
   *  op-level doesn't set them. */
  readonly adapter?: AdapterRef
}

export interface XOpenWebBuildMeta {
  readonly stable_id?: string
  readonly signature_id?: string
  readonly tool_version?: number
  readonly verified?: boolean
  readonly signals?: readonly string[]
}

// Operation-level x-openweb (on paths[].{method})
export interface XOpenWebOperation {
  readonly permission?: PermissionCategory
  readonly safety?: 'safe' | 'caution'
  readonly requires_auth?: boolean
  readonly build?: XOpenWebBuildMeta
  readonly transport?: Transport
  readonly auth?: AuthPrimitive | false
  readonly csrf?: (CsrfPrimitive & { readonly scope?: readonly string[] }) | false
  readonly signing?: SigningPrimitive | false
  /** Override or disable server-level auth_check rules. `false` disables. */
  readonly auth_check?: AuthCheckPrimitive | false
  readonly pagination?: PaginationPrimitive
  readonly extraction?: ExtractionPrimitive
  readonly adapter?: AdapterRef | false
  /** Real URL path when the spec key is a virtual path (e.g. GraphQL dedup) */
  readonly actual_path?: string
  /** Dot-path into the parsed response body to extract before returning (e.g. 'data', '0.data') */
  readonly unwrap?: string
  /** Wrap non-const request body params under this key (e.g. 'variables' for GraphQL) */
  readonly wrap?: string
  /** GraphQL query string injected at body root when wrap is active and the schema
   *  property name would conflict with a user-facing param (e.g. both named 'query') */
  readonly graphql_query?: string
  /** Apollo Automatic Persisted Query hash. Accepts raw hex or 'sha256:<hex>'.
   *  When set, request body includes extensions.persistedQuery.sha256Hash; if
   *  graphql_query is also set, the query is included as APQ cache-miss fallback. */
  readonly graphql_hash?: string
  /** Per-operation overrides for the page-acquisition plan. Each field here wins
   *  over the server-level page_plan, even when the value is falsy. */
  readonly page_plan?: PagePlanConfig
  /** When 'requires_interactive_solve', verify skips this op (CAPTCHA-gated). */
  readonly verify_status?: 'ok' | 'requires_interactive_solve'
}
