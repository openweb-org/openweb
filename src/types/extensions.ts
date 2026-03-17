import type {
  AuthPrimitive,
  CsrfPrimitive,
  ExtractionPrimitive,
  PaginationPrimitive,
  SigningPrimitive,
} from './primitives.js'

export type RiskTier = 'safe' | 'low' | 'medium' | 'high' | 'critical'

export type Transport = 'node' | 'page'

export interface AdapterRef {
  readonly name: string
  readonly operation: string
  readonly params?: { readonly [key: string]: unknown }
}

// Server-level x-openweb (on servers[] entries)
export interface XOpenWebServer {
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive & { readonly scope?: readonly string[] }
  readonly signing?: SigningPrimitive
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
  readonly risk_tier?: RiskTier
  readonly build?: XOpenWebBuildMeta
  readonly transport?: Transport
  readonly csrf?: CsrfPrimitive & { readonly scope?: readonly string[] }
  readonly pagination?: PaginationPrimitive
  readonly extraction?: ExtractionPrimitive
  readonly adapter?: AdapterRef
}
