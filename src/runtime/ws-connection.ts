import { EventEmitter } from 'node:events'

import type { WsAuthConfig, WsHeartbeat, WsMessageTemplate } from '../types/ws-primitives.js'
import { getValueAtPath, setValueAtPath } from './value-path.js'

// ── State Machine ─────────────────────────────────

export type WsState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'READY'
  | 'CLOSING'
  | 'CLOSED'
  | 'RECONNECTING'

interface Transition {
  readonly from: ReadonlySet<WsState>
  readonly to: WsState
}

const TRANSITIONS: Record<string, Transition> = {
  connect:        { from: new Set<WsState>(['DISCONNECTED']),    to: 'CONNECTING' },
  ws_open:        { from: new Set<WsState>(['CONNECTING']),      to: 'AUTHENTICATING' },
  auth_complete:  { from: new Set<WsState>(['AUTHENTICATING']),  to: 'READY' },
  close_request:  { from: new Set<WsState>(['READY']),           to: 'CLOSING' },
  ws_close:       { from: new Set<WsState>(['READY', 'CLOSING', 'AUTHENTICATING', 'CONNECTING']), to: 'CLOSED' },
  reconnect:      { from: new Set<WsState>(['READY', 'CONNECTING', 'AUTHENTICATING']), to: 'RECONNECTING' },
  retry:          { from: new Set<WsState>(['RECONNECTING']),    to: 'CONNECTING' },
}

// ── Config ────────────────────────────────────────

export interface WsReconnectConfig {
  readonly max_retries: number
  readonly backoff_ms: number
  readonly strategy?: 'exponential' | 'linear'
}

export interface WsConnectionConfig {
  readonly url: string
  readonly protocols?: string[]
  readonly headers?: Record<string, string>
  readonly auth?: WsAuthConfig
  readonly heartbeat?: WsHeartbeat
  readonly reconnect?: WsReconnectConfig
  /** Injected WebSocket constructor (for testing) */
  readonly WebSocketCtor?: { new(url: string | URL, protocols?: string | string[]): WebSocket }
}

// ── Events ────────────────────────────────────────

export interface WsConnectionEvents {
  open: []
  message: [data: unknown]
  close: [code: number, reason: string]
  error: [error: Error]
  stateChange: [from: WsState, to: WsState]
}

// ── Heartbeat ─────────────────────────────────────

function resolveTemplate(
  template: WsMessageTemplate,
  connectionState: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  let result: Record<string, unknown> = { ...template.constants }
  for (const binding of template.bindings) {
    let value: unknown
    switch (binding.source) {
      case 'state': value = connectionState[binding.key]; break
      case 'param': value = params[binding.key]; break
      case 'auth':  value = params[binding.key]; break
    }
    result = setValueAtPath(result, binding.path, value)
  }
  return result
}

// ── Connection Manager ────────────────────────────

export class WsConnectionManager extends EventEmitter<WsConnectionEvents> {
  private state: WsState = 'DISCONNECTED'
  private ws: WebSocket | null = null
  private retries = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatIntervalMs: number | undefined
  private missedAcks = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private authTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  readonly connectionState: Record<string, unknown> = {}
  readonly params: Record<string, unknown> = {}

  private readonly config: WsConnectionConfig
  private readonly WsCtor: { new(url: string | URL, protocols?: string | string[]): WebSocket }

  constructor(config: WsConnectionConfig) {
    super()
    this.config = config
    this.WsCtor = config.WebSocketCtor ?? globalThis.WebSocket
    this.heartbeatIntervalMs = config.heartbeat?.interval_ms
  }

  getState(): WsState {
    return this.state
  }

  private transition(event: string): boolean {
    const t = TRANSITIONS[event]
    if (!t || !t.from.has(this.state)) return false
    const from = this.state
    this.state = t.to
    this.emit('stateChange', from, t.to)
    return true
  }

  connect(): void {
    if (!this.transition('connect')) return
    this.openSocket()
  }

  send(data: unknown): void {
    if (this.state !== 'READY' || !this.ws) return
    this.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
  }

  close(): void {
    if (!this.transition('close_request')) return
    this.stopHeartbeat()
    this.ws?.close(1000, 'client close')
  }

  /** Handle an incoming heartbeat ack */
  handleHeartbeatAck(): void {
    this.missedAcks = 0
  }

  /** Extract heartbeat interval from hello message, start heartbeat, complete auth */
  handleHello(payload: unknown): void {
    if (this.state !== 'AUTHENTICATING') return

    // Extract dynamic interval from hello payload
    const hb = this.config.heartbeat
    if (hb?.interval_field && payload && typeof payload === 'object') {
      const dynamic = getValueAtPath(payload, hb.interval_field)
      if (typeof dynamic === 'number' && dynamic > 0) {
        this.heartbeatIntervalMs = dynamic
      }
    }

    // If auth is ws_first_message, send auth message now
    if (this.config.auth?.type === 'ws_first_message') {
      // Auth message will be sent by the executor which has the token
      // For now, transition directly — executor calls completeAuth()
    }

    // If no auth needed, go straight to READY
    if (!this.config.auth) {
      this.completeAuth()
    }
  }

  /** Complete authentication and transition to READY */
  completeAuth(): void {
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer)
      this.authTimeoutTimer = null
    }
    if (!this.transition('auth_complete')) return
    this.retries = 0
    this.startHeartbeat()
  }

  // ── Internal ──────────────────────────────────

  private openSocket(): void {
    const ws = new this.WsCtor(this.config.url, this.config.protocols)
    this.ws = ws

    ws.addEventListener('open', () => {
      if (!this.transition('ws_open')) return
      this.emit('open')

      // Start auth timeout
      this.authTimeoutTimer = setTimeout(() => {
        if (this.state === 'AUTHENTICATING') {
          this.attemptReconnect()
        }
      }, 10_000)
    })

    ws.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? tryParse(event.data) : event.data
      this.emit('message', data)
    })

    ws.addEventListener('close', (event) => {
      this.stopHeartbeat()
      if (this.state === 'CLOSING') {
        this.transition('ws_close')
        this.emit('close', event.code, event.reason)
        return
      }
      // Unexpected close — attempt reconnect
      if (this.shouldReconnect()) {
        this.attemptReconnect()
      } else {
        this.transition('ws_close')
        this.emit('close', event.code, event.reason)
      }
    })

    ws.addEventListener('error', () => {
      const err = new Error(`WebSocket error on ${this.config.url}`)
      this.emit('error', err)
      // The 'close' event fires after 'error', which handles reconnect
    })
  }

  private shouldReconnect(): boolean {
    if (!this.config.reconnect) return false
    return this.retries < this.config.reconnect.max_retries
  }

  private attemptReconnect(): void {
    if (!this.transition('reconnect')) return
    this.stopHeartbeat()
    this.ws = null

    const rc = this.config.reconnect
    if (!rc || this.retries >= rc.max_retries) {
      this.state = 'CLOSED' // force closed
      this.emit('stateChange', 'RECONNECTING', 'CLOSED')
      this.emit('error', new Error(`Max reconnect retries (${rc?.max_retries ?? 0}) exceeded`))
      return
    }

    const delay = rc.strategy === 'linear'
      ? rc.backoff_ms * (this.retries + 1)
      : rc.backoff_ms * 2 ** this.retries

    this.retries++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.transition('retry')) {
        this.openSocket()
      }
    }, delay)
  }

  private startHeartbeat(): void {
    const hb = this.config.heartbeat
    if (!hb) return
    const interval = this.heartbeatIntervalMs ?? hb.interval_ms
    if (!interval || interval <= 0) return

    const maxMissed = hb.max_missed ?? 3
    this.missedAcks = 0

    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'READY') return
      const msg = resolveTemplate(hb.send, this.connectionState, this.params)
      this.send(msg)
      this.missedAcks++
      if (this.missedAcks > maxMissed) {
        this.attemptReconnect()
      }
    }, interval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.authTimeoutTimer) {
      clearTimeout(this.authTimeoutTimer)
      this.authTimeoutTimer = null
    }
  }

  /** Clean up all resources */
  destroy(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close(1000, 'destroy')
      this.ws = null
    }
    this.state = 'CLOSED'
    this.removeAllListeners()
  }
}

function tryParse(data: string): unknown {
  try { return JSON.parse(data) } catch { return data }
}
