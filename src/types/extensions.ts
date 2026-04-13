import type {
  AuthPrimitive,
  CsrfPrimitive,
  ExtractionPrimitive,
  PaginationPrimitive,
  SigningPrimitive,
} from './primitives.js'

export type PermissionCategory = 'read' | 'write' | 'delete' | 'transact'

export type Transport = 'node' | 'page'

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
  /** Constant headers merged into every node-transport request to this server.
   *  Useful for per-site User-Agent overrides, API keys, etc. */
  readonly headers?: Readonly<Record<string, string>>
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
  readonly pagination?: PaginationPrimitive
  readonly extraction?: ExtractionPrimitive
  readonly adapter?: AdapterRef
  /** Real URL path when the spec key is a virtual path (e.g. GraphQL dedup) */
  readonly actual_path?: string
  /** Dot-path into the parsed response body to extract before returning (e.g. 'data', '0.data') */
  readonly unwrap?: string
  /** Wrap non-const request body params under this key (e.g. 'variables' for GraphQL) */
  readonly wrap?: string
  /** GraphQL query string injected at body root when wrap is active and the schema
   *  property name would conflict with a user-facing param (e.g. both named 'query') */
  readonly graphql_query?: string
}
