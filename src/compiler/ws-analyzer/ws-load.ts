import { readFile } from 'node:fs/promises'

import type { WsFrame } from '../../capture/types.js'

// ── Output types ──────────────────────────────────────────────

export interface WsHandshake {
  readonly requestHeaders: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly responseStatus: number
  readonly responseHeaders: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly subprotocol?: string
}

export interface ParsedWsFrame {
  readonly direction: 'sent' | 'received'
  readonly timestamp: number
  readonly payload: Record<string, unknown>
}

export interface WsConnection {
  readonly connectionId: string
  readonly url: string
  readonly frames: ParsedWsFrame[]
  readonly handshake?: WsHandshake
  readonly openTimestamp: number
  readonly closeTimestamp?: number
  readonly closeCode?: number
}

// ── Helpers ───────────────────────────────────────────────────

/** Binary frame opcode per RFC 6455. */
const OPCODE_BINARY = 2

function isoToMs(iso: string): number {
  return new Date(iso).getTime()
}

function tryParseJson(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────

/**
 * Load a WS capture JSONL file and return structured connections.
 *
 * Steps:
 * 1. Parse each JSONL line as a WsFrame
 * 2. Group by connectionId
 * 3. Order by timestamp within each connection
 * 4. Parse JSON payloads; skip binary and non-JSON text frames
 * 5. Extract handshake metadata from open frames
 */
export async function loadWsCapture(jsonlPath: string): Promise<WsConnection[]> {
  const content = await readFile(jsonlPath, 'utf-8')
  return parseWsCapture(content)
}

/** Parse JSONL content directly (useful for testing without filesystem). */
export function parseWsCapture(content: string): WsConnection[] {
  const lines = content.split('\n').filter((l) => l.trim() !== '')
  const frames: WsFrame[] = lines.map((line) => JSON.parse(line) as WsFrame)
  return groupConnections(frames)
}

function groupConnections(frames: WsFrame[]): WsConnection[] {
  // Group by connectionId
  const byConnection = new Map<string, WsFrame[]>()
  for (const frame of frames) {
    const group = byConnection.get(frame.connectionId)
    if (group) {
      group.push(frame)
    } else {
      byConnection.set(frame.connectionId, [frame])
    }
  }

  const connections: WsConnection[] = []

  for (const [connectionId, connFrames] of byConnection) {
    // Sort by timestamp
    connFrames.sort((a, b) => isoToMs(a.timestamp) - isoToMs(b.timestamp))

    let url = ''
    let handshake: WsHandshake | undefined
    let openTimestamp = 0
    let closeTimestamp: number | undefined
    let closeCode: number | undefined
    const parsed: ParsedWsFrame[] = []

    for (const frame of connFrames) {
      if (frame.type === 'open') {
        url = frame.url
        openTimestamp = isoToMs(frame.timestamp)
        handshake = extractHandshake(frame)
      } else if (frame.type === 'close') {
        closeTimestamp = isoToMs(frame.timestamp)
        closeCode = frame.code
      } else {
        // frame.type === 'frame'
        if (frame.opcode === OPCODE_BINARY) continue
        const payload = tryParseJson(frame.payload)
        if (!payload) continue
        parsed.push({
          direction: frame.direction,
          timestamp: isoToMs(frame.timestamp),
          payload,
        })
      }
    }

    connections.push({
      connectionId,
      url,
      frames: parsed,
      handshake,
      openTimestamp,
      closeTimestamp,
      closeCode,
    })
  }

  return connections
}

function extractHandshake(
  frame: Extract<WsFrame, { type: 'open' }>,
): WsHandshake | undefined {
  if (!frame.requestHeaders && !frame.responseHeaders) return undefined
  return {
    requestHeaders: frame.requestHeaders ?? [],
    responseStatus: frame.responseStatus ?? 0,
    responseHeaders: frame.responseHeaders ?? [],
    subprotocol: frame.subprotocol,
  }
}
