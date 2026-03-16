import type {
  AuthPrimitive,
  CsrfPrimitive,
  ExtractionPrimitive,
  PaginationPrimitive,
  SigningPrimitive,
} from './primitives.js'

export type RiskTier = 'safe' | 'low' | 'medium' | 'high' | 'critical'

export type ExecutionMode = 'direct_http' | 'session_http' | 'browser_fetch'

export interface AdapterRef {
  readonly name: string
  readonly operation: string
  readonly params?: { readonly [key: string]: unknown }
}

// Server-level x-openweb (on servers[] entries)
export interface XOpenWebServer {
  readonly mode: ExecutionMode
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive & { readonly scope?: readonly string[] }
  readonly signing?: SigningPrimitive
}

// Operation-level x-openweb (on paths[].{method})
export interface XOpenWebOperation {
  readonly risk_tier?: RiskTier
  readonly stable_id?: string
  readonly signature_id?: string
  readonly tool_version?: number
  readonly verified?: boolean
  readonly signals?: readonly string[]
  readonly mode?: ExecutionMode
  readonly human_handoff?: boolean
  readonly csrf?: CsrfPrimitive & { readonly scope?: readonly string[] }
  readonly pagination?: PaginationPrimitive
  readonly extraction?: ExtractionPrimitive
  readonly adapter?: AdapterRef
}
