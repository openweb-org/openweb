import { WebSocket as NodeWebSocket } from 'ws'

export type WsSocketFactory = (
  url: string,
  protocols: string[] | undefined,
  headers: Record<string, string> | undefined,
) => WebSocket

export function createNodeSocketFactory(): WsSocketFactory {
  return (url, protocols, headers) =>
    new NodeWebSocket(url, protocols, { headers }) as unknown as WebSocket
}

export const defaultSocketFactory: WsSocketFactory = (url, protocols) =>
  new globalThis.WebSocket(url, protocols)
