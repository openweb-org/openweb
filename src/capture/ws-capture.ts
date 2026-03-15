import type { CDPSession } from 'playwright'

import type { WsFrame } from './types.js'

export interface WsCapture {
  readonly frames: WsFrame[]
  detach(): void
}

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

export async function attachWsCapture(cdp: CDPSession): Promise<WsCapture> {
  await cdp.send('Network.enable')

  const frames: WsFrame[] = []

  const onCreated = (e: CdpWebSocketCreated): void => {
    frames.push({
      connectionId: e.requestId,
      timestamp: new Date().toISOString(),
      type: 'open',
      url: e.url,
    })
  }

  const onFrameSent = (e: CdpWebSocketFrame): void => {
    frames.push({
      connectionId: e.requestId,
      timestamp: new Date().toISOString(),
      type: 'frame',
      direction: 'sent',
      opcode: e.response.opcode,
      payload: e.response.payloadData,
    })
  }

  const onFrameReceived = (e: CdpWebSocketFrame): void => {
    frames.push({
      connectionId: e.requestId,
      timestamp: new Date().toISOString(),
      type: 'frame',
      direction: 'received',
      opcode: e.response.opcode,
      payload: e.response.payloadData,
    })
  }

  const onClosed = (e: CdpWebSocketClosed): void => {
    frames.push({
      connectionId: e.requestId,
      timestamp: new Date().toISOString(),
      type: 'close',
    })
  }

  cdp.on('Network.webSocketCreated', onCreated)
  cdp.on('Network.webSocketFrameSent', onFrameSent)
  cdp.on('Network.webSocketFrameReceived', onFrameReceived)
  cdp.on('Network.webSocketClosed', onClosed)

  return {
    frames,
    detach() {
      cdp.off('Network.webSocketCreated', onCreated)
      cdp.off('Network.webSocketFrameSent', onFrameSent)
      cdp.off('Network.webSocketFrameReceived', onFrameReceived)
      cdp.off('Network.webSocketClosed', onClosed)
    },
  }
}
