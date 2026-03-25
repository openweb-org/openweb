import type { PermissionCategory } from './extensions.js'
import type {
  WsAuthConfig,
  WsDiscriminatorConfig,
  WsHeartbeat,
  WsMessageTemplate,
  WsPattern,
} from './ws-primitives.js'
import type { XOpenWebBuildMeta } from './extensions.js'

// ── Server-level x-openweb (on AsyncAPI servers) ───

export interface XOpenWebWsServer {
  readonly transport: 'node' | 'page'
  readonly auth?: WsAuthConfig
  readonly heartbeat?: WsHeartbeat
  readonly discriminator: WsDiscriminatorConfig
  readonly reconnect?: {
    readonly max_retries: number
    readonly backoff_ms: number
    readonly resume_field?: string
  }
}

// ── Operation-level x-openweb (on AsyncAPI operations) ─

export interface XOpenWebWsOperation {
  readonly permission: PermissionCategory
  readonly pattern: WsPattern
  readonly subscribe_message?: WsMessageTemplate
  readonly unsubscribe_message?: WsMessageTemplate
  readonly correlation?: {
    readonly field: string
    readonly source: 'echo' | 'sequence' | 'uuid'
  }
  readonly build?: XOpenWebBuildMeta
}
