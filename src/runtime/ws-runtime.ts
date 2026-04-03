import { createHash } from 'node:crypto'

import type { AsyncApiOperationRef, AsyncApiSpec } from '../lib/asyncapi.js'
import { listAsyncApiOperations } from '../lib/asyncapi.js'
import { OpenWebError } from '../lib/errors.js'
import type { XOpenWebWsServer } from '../types/ws-extensions.js'
import { type WsAuthResult, resolveWsAuth } from './primitives/ws-registry.js'
import type { WsConnectionConfig, WsConnectionManager } from './ws-connection.js'
import { WsConnectionPool } from './ws-pool.js'
import { type EventRoute, WsRouter, type WsRouterConfig } from './ws-router.js'
import type { WsSocketFactory } from './ws-socket.js'
import { createNodeSocketFactory } from './ws-socket.js'

// ── Types ────────────────────────────────────────

export interface WsRuntimeDeps {
  readonly httpAuth?: { token?: string; headers?: Record<string, string>; cookieString?: string }
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
  readonly socketFactory?: WsSocketFactory
}

export interface WsSession {
  readonly connection: WsConnectionManager
  readonly router: WsRouter
  readonly poolKey: string
}

// ── Helpers ──────────────────────────────────────

function hash8(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function extractServer(spec: AsyncApiSpec): { name: string; host: string; pathname: string; ext: XOpenWebWsServer } {
  const servers = spec.servers ?? {}
  const [name, server] = Object.entries(servers)[0] ?? []
  if (!name || !server) throw new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED',
    message: 'AsyncAPI spec has no servers', action: 'Check the site AsyncAPI spec.',
    retriable: false, failureClass: 'fatal',
  })
  const ext = server['x-openweb']
  if (!ext) throw new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED',
    message: `Server ${name} missing x-openweb extension`, action: 'Check the site AsyncAPI spec.',
    retriable: false, failureClass: 'fatal',
  })
  return { name, host: server.host, pathname: server.pathname ?? '/', ext }
}

function buildWsUrl(host: string, pathname: string): string {
  return `wss://${host}${pathname}`
}

function applyAuthToConfig(
  base: { url: string; headers?: Record<string, string>; authPayload?: Record<string, unknown> },
  authResult: WsAuthResult | undefined,
): { url: string; headers?: Record<string, string>; authPayload?: Record<string, unknown> } {
  if (!authResult) return base
  switch (authResult.type) {
    case 'url':
      return { ...base, url: authResult.url }
    case 'headers':
      return { ...base, headers: { ...base.headers, ...authResult.headers } }
    case 'first_message':
      return { ...base, authPayload: authResult.payload }
  }
}

function buildEventRoutes(spec: AsyncApiSpec): EventRoute[] {
  const routes: EventRoute[] = []
  for (const ref of listAsyncApiOperations(spec)) {
    const ext = ref.operation['x-openweb']
    if (ext?.event_match) {
      routes.push({ operationId: ref.operationId, match: ext.event_match as Record<string, unknown> })
    }
  }
  return routes
}

function buildRouter(serverExt: XOpenWebWsServer, spec: AsyncApiSpec): WsRouter {
  const config: WsRouterConfig = {
    discriminator: serverExt.discriminator,
    controlPatterns: [],
    ackPatterns: serverExt.heartbeat?.ack_discriminator
      ? [{ match: serverExt.heartbeat.ack_discriminator as Record<string, unknown> }]
      : [],
    responsePattern: undefined,
    eventRoutes: buildEventRoutes(spec),
  }
  return new WsRouter(config)
}

// ── Main entry ───────────────────────────────────

export async function openWsSession(
  site: string,
  asyncapi: AsyncApiSpec,
  params: Record<string, unknown>,
  pool: WsConnectionPool,
  deps?: WsRuntimeDeps,
): Promise<WsSession> {
  const { host, pathname, ext: serverExt } = extractServer(asyncapi)
  const wsUrl = buildWsUrl(host, pathname)

  // SSRF validation — convert wss:// → https:// for DNS check
  if (deps?.ssrfValidator) {
    await deps.ssrfValidator(wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://'))
  }

  // Resolve auth
  const authResult = serverExt.auth
    ? await resolveWsAuth(serverExt.auth, { url: wsUrl, params, httpAuth: deps?.httpAuth })
    : undefined

  // Build connection config
  const authApplied = applyAuthToConfig({ url: wsUrl }, authResult)
  const connConfig: WsConnectionConfig = {
    url: authApplied.url,
    headers: authApplied.headers,
    authPayload: authApplied.authPayload,
    auth: serverExt.auth,
    heartbeat: serverExt.heartbeat,
    reconnect: serverExt.reconnect,
    socketFactory: deps?.socketFactory ?? createNodeSocketFactory(),
  }

  // Build pool key with auth fingerprint
  const authFingerprint = authResult ? hash8(JSON.stringify(authResult)) : 'none'
  const poolKey = WsConnectionPool.buildKey(site, wsUrl, authFingerprint)

  // Acquire connection
  const connection = pool.acquire(poolKey, connConfig)

  // Connect if needed
  if (connection.getState() === 'DISCONNECTED') {
    connection.connect()
  }

  // Build router
  const router = buildRouter(serverExt, asyncapi)

  // Attach control-plane listener
  const controlListener = (data: unknown) => {
    const classified = router.classify(data)
    if (classified.category === 'control') connection.handleHello(classified.payload)
    if (classified.category === 'ack') connection.handleHeartbeatAck()
  }
  connection.on('message', controlListener)

  // Wait for READY
  if (connection.getState() !== 'READY') {
    await waitForReady(connection, 15_000)
  }

  return { connection, router, poolKey }
}

function waitForReady(connection: WsConnectionManager, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (connection.getState() === 'READY') { resolve(); return }

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      connection.removeListener('stateChange', onState)
      connection.removeListener('error', onError)
      reject(new Error(`WS connection did not reach READY within ${timeoutMs}ms (state: ${connection.getState()})`))
    }, timeoutMs)

    function onState(_from: string, to: string) {
      if (settled) return
      if (to === 'READY') {
        settled = true
        clearTimeout(timer)
        connection.removeListener('stateChange', onState)
        connection.removeListener('error', onError)
        resolve()
      } else if (to === 'CLOSED') {
        settled = true
        clearTimeout(timer)
        connection.removeListener('stateChange', onState)
        connection.removeListener('error', onError)
        reject(new Error('WS connection closed before reaching READY'))
      }
    }

    function onError(err: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.removeListener('stateChange', onState)
      connection.removeListener('error', onError)
      reject(err)
    }

    connection.on('stateChange', onState)
    connection.on('error', onError)
  })
}
