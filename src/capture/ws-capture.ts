import type { CDPSession } from 'patchright'

import type { WsFrame } from './types.js'

export interface WsCapture {
  readonly frames: WsFrame[]
  detach(): void
}

// ── CDP event param types ──────────────────────────────────────

interface CdpWebSocketCreated {
  readonly requestId: string
  readonly url: string
}

interface CdpWebSocketFrame {
  readonly requestId: string
  readonly timestamp: number
  readonly response: { readonly opcode: number; readonly payloadData: string }
}

interface CdpWebSocketClosed {
  readonly requestId: string
  readonly timestamp: number
}

interface CdpWebSocketHandshakeRequest {
  readonly requestId: string
  readonly timestamp: number
  readonly wallTime: number
  readonly request: { readonly headers: Readonly<Record<string, string>> }
}

interface CdpWebSocketHandshakeResponse {
  readonly requestId: string
  readonly timestamp: number
  readonly response: {
    readonly status: number
    readonly statusText: string
    readonly headers: Readonly<Record<string, string>>
  }
}

// ── Helpers ────────────────────────────────────────────────────

function headersToArray(
  headers: Readonly<Record<string, string>>,
): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

/** Extract close code from a WebSocket close frame payload (opcode 8). */
function extractCloseCode(payloadData: string): number | undefined {
  if (payloadData.length >= 2) {
    const code = (payloadData.charCodeAt(0) << 8) | payloadData.charCodeAt(1)
    if (code >= 1000 && code <= 4999) return code
  }
  return undefined
}

// ── Pending handshake accumulator ──────────────────────────────

interface PendingHandshake {
  url: string
  requestHeaders?: Array<{ name: string; value: string }>
  responseStatus?: number
  responseHeaders?: Array<{ name: string; value: string }>
  subprotocol?: string
  cdpTimestamp?: number
}

// ── Main ───────────────────────────────────────────────────────

export async function attachWsCapture(cdp: CDPSession): Promise<WsCapture> {
  await cdp.send('Network.enable')

  const frames: WsFrame[] = []
  const pending = new Map<string, PendingHandshake>()
  const closeCodes = new Map<string, number>()

  // Calibration pair: first CDP monotonic timestamp ↔ wall-clock.
  let wallBase: number | null = null
  let cdpBase: number | null = null

  function calibrate(cdpTimestamp: number, wallTime: number): void {
    if (wallBase === null) {
      wallBase = wallTime * 1000
      cdpBase = cdpTimestamp
    }
  }

  function cdpToIso(cdpTimestamp: number): string {
    if (wallBase !== null && cdpBase !== null) {
      const ms = wallBase + (cdpTimestamp - cdpBase) * 1000
      return new Date(ms).toISOString()
    }
    // Fallback before calibration (should not happen for frames)
    return new Date().toISOString()
  }

  // ── Event handlers ─────────────────────────────────────────

  const onCreated = (e: CdpWebSocketCreated): void => {
    pending.set(e.requestId, { url: e.url })
  }

  const onHandshakeRequest = (e: CdpWebSocketHandshakeRequest): void => {
    calibrate(e.timestamp, e.wallTime)
    const p = pending.get(e.requestId)
    if (p) {
      p.requestHeaders = headersToArray(e.request.headers)
      p.cdpTimestamp = e.timestamp
    }
  }

  const onHandshakeResponse = (e: CdpWebSocketHandshakeResponse): void => {
    const p = pending.get(e.requestId)
    if (!p) return

    p.responseStatus = e.response.status
    p.responseHeaders = headersToArray(e.response.headers)

    const proto = e.response.headers['Sec-WebSocket-Protocol'] ?? e.response.headers['sec-websocket-protocol']
    if (proto) p.subprotocol = proto

    // Emit open frame with full handshake data
    frames.push({
      connectionId: e.requestId,
      timestamp: cdpToIso(p.cdpTimestamp ?? e.timestamp),
      type: 'open',
      url: p.url,
      requestHeaders: p.requestHeaders,
      responseStatus: p.responseStatus,
      responseHeaders: p.responseHeaders,
      subprotocol: p.subprotocol,
    })

    pending.delete(e.requestId)
  }

  const onFrameSent = (e: CdpWebSocketFrame): void => {
    flushPending(e.requestId, e.timestamp)
    frames.push({
      connectionId: e.requestId,
      timestamp: cdpToIso(e.timestamp),
      type: 'frame',
      direction: 'sent',
      opcode: e.response.opcode,
      payload: e.response.payloadData,
    })
  }

  const onFrameReceived = (e: CdpWebSocketFrame): void => {
    flushPending(e.requestId, e.timestamp)

    // Track close code from close frames (opcode 8)
    if (e.response.opcode === 8) {
      const code = extractCloseCode(e.response.payloadData)
      if (code !== undefined) closeCodes.set(e.requestId, code)
    }

    frames.push({
      connectionId: e.requestId,
      timestamp: cdpToIso(e.timestamp),
      type: 'frame',
      direction: 'received',
      opcode: e.response.opcode,
      payload: e.response.payloadData,
    })
  }

  const onClosed = (e: CdpWebSocketClosed): void => {
    flushPending(e.requestId, e.timestamp)
    frames.push({
      connectionId: e.requestId,
      timestamp: cdpToIso(e.timestamp),
      type: 'close',
      code: closeCodes.get(e.requestId),
    })
    closeCodes.delete(e.requestId)
    pending.delete(e.requestId)
  }

  /** If handshake never completed, flush a basic open frame. */
  function flushPending(requestId: string, cdpTimestamp: number): void {
    const p = pending.get(requestId)
    if (!p) return
    frames.push({
      connectionId: requestId,
      timestamp: cdpToIso(p.cdpTimestamp ?? cdpTimestamp),
      type: 'open',
      url: p.url,
      requestHeaders: p.requestHeaders,
    })
    pending.delete(requestId)
  }

  // ── Register listeners ─────────────────────────────────────

  cdp.on('Network.webSocketCreated', onCreated)
  cdp.on('Network.webSocketWillSendHandshakeRequest', onHandshakeRequest)
  cdp.on('Network.webSocketHandshakeResponseReceived', onHandshakeResponse)
  cdp.on('Network.webSocketFrameSent', onFrameSent)
  cdp.on('Network.webSocketFrameReceived', onFrameReceived)
  cdp.on('Network.webSocketClosed', onClosed)

  return {
    frames,
    detach() {
      cdp.off('Network.webSocketCreated', onCreated)
      cdp.off('Network.webSocketWillSendHandshakeRequest', onHandshakeRequest)
      cdp.off('Network.webSocketHandshakeResponseReceived', onHandshakeResponse)
      cdp.off('Network.webSocketFrameSent', onFrameSent)
      cdp.off('Network.webSocketFrameReceived', onFrameReceived)
      cdp.off('Network.webSocketClosed', onClosed)
    },
  }
}
