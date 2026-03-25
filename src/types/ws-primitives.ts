import type { Inject } from './primitives.js'

// ── Discriminator ──────────────────────────────────

export interface WsDiscriminator {
  readonly field: string
  readonly sub_field?: string
  readonly sub_field_on?: string | number
}

export interface WsDiscriminatorConfig {
  readonly sent: WsDiscriminator | null
  readonly received: WsDiscriminator | null
}

// ── Auth ────────────────────────────────────────────

export interface WsFirstMessage {
  readonly type: 'ws_first_message'
  readonly discriminator: Readonly<Record<string, unknown>>
  readonly token_path: string
  readonly token_source: 'http_auth' | 'param'
}

export interface WsUpgradeHeader {
  readonly type: 'ws_upgrade_header'
  readonly inject: Inject
}

export interface WsUrlToken {
  readonly type: 'ws_url_token'
  readonly param: string
  readonly token_source: 'http_auth' | 'param'
}

export interface WsHttpHandshake {
  readonly type: 'ws_http_handshake'
  readonly endpoint: string
  readonly method: 'GET' | 'POST'
  readonly url_path: string
}

export type WsAuthConfig = WsFirstMessage | WsUpgradeHeader | WsUrlToken | WsHttpHandshake

// ── Message Template + Binding ─────────────────────

export interface WsBinding {
  readonly path: string
  readonly source: 'param' | 'auth' | 'state'
  readonly key: string
}

export interface WsMessageTemplate {
  readonly constants: Readonly<Record<string, unknown>>
  readonly bindings: readonly WsBinding[]
}

// ── Heartbeat ──────────────────────────────────────

export interface WsHeartbeat {
  readonly send: WsMessageTemplate
  readonly ack_discriminator?: Readonly<Record<string, unknown>>
  readonly interval_field?: string
  readonly interval_ms?: number
  readonly max_missed?: number
}

// ── Pattern ────────────────────────────────────────

export type WsPattern = 'heartbeat' | 'request_reply' | 'subscribe' | 'publish' | 'stream'
