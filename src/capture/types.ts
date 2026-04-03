/** Capture-module types — aligned with doc/todo/v2/browser-integration.md */

// ── WebSocket frame (JSONL rows) ────────────────────────────────

export type WsFrame =
  | {
      readonly connectionId: string
      readonly timestamp: string
      readonly type: 'open'
      readonly url: string
      readonly requestHeaders?: ReadonlyArray<{ readonly name: string; readonly value: string }>
      readonly responseStatus?: number
      readonly responseHeaders?: ReadonlyArray<{ readonly name: string; readonly value: string }>
      readonly subprotocol?: string
    }
  | {
      readonly connectionId: string
      readonly timestamp: string
      readonly type: 'frame'
      readonly direction: 'sent' | 'received'
      readonly opcode: number
      readonly payload: string
    }
  | { readonly connectionId: string; readonly timestamp: string; readonly type: 'close'; readonly code?: number }

// ── Browser state snapshot ──────────────────────────────────────

export interface CookieEntry {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: 'Strict' | 'Lax' | 'None'
  readonly expires: number
}

export interface StateSnapshot {
  readonly timestamp: string
  readonly trigger: 'initial' | 'navigation' | 'manual'
  readonly url: string
  readonly localStorage: Record<string, string>
  readonly sessionStorage: Record<string, string>
  readonly cookies: readonly CookieEntry[]
}

// ── DOM & globals extraction ────────────────────────────────────

export interface DomExtraction {
  readonly timestamp: string
  readonly trigger: 'initial' | 'navigation' | 'manual'
  readonly url: string
  readonly metaTags: ReadonlyArray<{ readonly name: string; readonly content: string }>
  readonly scriptJsonTags: ReadonlyArray<{
    readonly id: string | null
    readonly type: string | null
    readonly dataTarget: string | null
    readonly size: number
  }>
  readonly hiddenInputs: ReadonlyArray<{ readonly name: string | null; readonly formAction: string | null }>
  readonly globals: Readonly<Record<string, string>>
  readonly webpackChunks: readonly string[]
  readonly gapiAvailable: boolean
}

// ── Capture metadata ────────────────────────────────────────────

export interface CaptureMetadata {
  readonly siteUrl: string
  readonly startTime: string
  readonly endTime: string
  readonly pageCount: number
  readonly requestCount: number
  readonly wsConnectionCount: number
  readonly snapshotCount: number
  readonly captureVersion: string
}

// ── HAR types (minimal subset for building HAR 1.2) ─────────────

export interface HarRequest {
  readonly method: string
  readonly url: string
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly postData?: string
}

export interface HarResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly content: {
    readonly size: number
    readonly mimeType: string
    readonly text?: string
  }
}

export interface HarEntry {
  readonly startedDateTime: string
  readonly time: number
  readonly request: HarRequest
  readonly response: HarResponse
}

export interface HarLog {
  readonly version: string
  readonly creator: { readonly name: string; readonly version: string }
  readonly entries: HarEntry[]
}
