import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { validateAsyncApiSpec } from '../../types/validator.js'
import type { XOpenWebWsServer } from '../../types/ws-extensions.js'
import type { WsOperationSchema } from '../ws-analyzer/ws-schema.js'
import { generateAsyncApi } from './asyncapi.js'

const SERVER_URL = 'wss://gateway.example.com/ws'

const SERVER_EXTENSIONS: XOpenWebWsServer = {
  transport: 'node',
  discriminator: {
    sent: { field: 'op' },
    received: { field: 'op', sub_field: 't', sub_field_on: 0 },
  },
  heartbeat: {
    send: {
      constants: { op: 1 },
      bindings: [{ path: 'd', source: 'state', key: 'sequence' }],
    },
    ack_discriminator: { op: 11 },
    interval_field: 'd.heartbeat_interval',
    max_missed: 3,
  },
  auth: {
    type: 'ws_first_message',
    discriminator: { op: 2 },
    token_path: 'd.token',
    token_source: 'param',
  },
  reconnect: {
    max_retries: 5,
    backoff_ms: 1000,
  },
}

function makeOps(overrides?: Partial<WsOperationSchema>[]): WsOperationSchema[] {
  const defaults: WsOperationSchema[] = [
    {
      operationId: 'ws_recv_message_create',
      pattern: 'stream',
      direction: 'received',
      payloadSchema: {
        type: 'object',
        required: ['op', 't', 'd'],
        properties: {
          op: { type: 'integer' },
          t: { type: 'string' },
          d: { type: 'object' },
        },
      },
    },
    {
      operationId: 'ws_send_subscribe',
      pattern: 'subscribe',
      direction: 'sent',
      payloadSchema: {
        type: 'object',
        required: ['action', 'symbols'],
        properties: {
          action: { type: 'string' },
          symbols: { type: 'array', items: { type: 'string' } },
        },
      },
      messageTemplate: {
        constants: { action: 'subscribe' },
        bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
      },
    },
  ]

  if (!overrides) return defaults
  return defaults.map((op, i) => ({ ...op, ...(overrides[i] ?? {}) }))
}

async function generateAndParse(ops?: WsOperationSchema[], ext?: XOpenWebWsServer) {
  const outputBaseDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-asyncapi-test-'))
  const outputRoot = path.join(outputBaseDir, 'test-site')

  await generateAsyncApi({
    site: 'test-site',
    serverUrl: SERVER_URL,
    serverExtensions: ext ?? SERVER_EXTENSIONS,
    operations: ops ?? makeOps(),
    outputRoot,
    generatedAt: '2026-03-25T00:00:00.000Z',
  })

  const raw = await readFile(path.join(outputRoot, 'asyncapi.yaml'), 'utf8')
  const spec = parse(raw) as Record<string, unknown>

  return { outputBaseDir, outputRoot, raw, spec }
}

describe('generateAsyncApi', () => {
  it('produces valid AsyncAPI 3.0 spec', async () => {
    const { outputBaseDir, spec } = await generateAndParse()
    try {
      const result = validateAsyncApiSpec(spec)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('has correct top-level structure', async () => {
    const { outputBaseDir, spec } = await generateAndParse()
    try {
      expect(spec.asyncapi).toBe('3.0.0')

      const info = spec.info as Record<string, unknown>
      expect(info.title).toBe('test-site WebSocket API')
      expect(info.version).toBe('1.0.0')

      const xopenweb = info['x-openweb'] as Record<string, unknown>
      expect(xopenweb.spec_version).toBe('2.0')
      expect(xopenweb.compiled_at).toBe('2026-03-25T00:00:00.000Z')

      expect(spec.servers).toBeDefined()
      expect(spec.channels).toBeDefined()
      expect(spec.operations).toBeDefined()
      expect(spec.components).toBeDefined()
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits server with x-openweb extensions', async () => {
    const { outputBaseDir, raw } = await generateAndParse()
    try {
      // Server-level x-openweb
      expect(raw).toContain('protocol: wss')
      expect(raw).toContain('transport: node')
      expect(raw).toContain('field: op')
      expect(raw).toContain('sub_field: t')
      expect(raw).toContain('max_retries: 5')
      expect(raw).toContain('backoff_ms: 1000')

      // Auth
      expect(raw).toContain('type: ws_first_message')
      expect(raw).toContain('token_path: d.token')

      // Heartbeat
      expect(raw).toContain('interval_field: d.heartbeat_interval')
      expect(raw).toContain('max_missed: 3')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits operation-level x-openweb extensions', async () => {
    const { outputBaseDir, spec } = await generateAndParse()
    try {
      const ops = spec.operations as Record<string, Record<string, unknown>>

      // Receive stream operation
      const recv = ops.ws_recv_message_create
      expect(recv).toBeDefined()
      expect(recv.action).toBe('receive')
      const recvExt = recv['x-openweb'] as Record<string, unknown>
      expect(recvExt.permission).toBe('read')
      expect(recvExt.pattern).toBe('stream')
      expect(recvExt.build).toBeDefined()

      // Subscribe send operation
      const send = ops.ws_send_subscribe
      expect(send).toBeDefined()
      expect(send.action).toBe('send')
      const sendExt = send['x-openweb'] as Record<string, unknown>
      expect(sendExt.permission).toBe('write')
      expect(sendExt.pattern).toBe('subscribe')
      expect(sendExt.subscribe_message).toEqual({
        constants: { action: 'subscribe' },
        bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
      })
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('emits components with schemas and messages', async () => {
    const { outputBaseDir, spec } = await generateAndParse()
    try {
      const components = spec.components as Record<string, Record<string, unknown>>

      // Messages reference schemas
      const msgs = components.messages as Record<string, Record<string, unknown>>
      expect(msgs.WsRecvMessageCreate).toBeDefined()
      expect(msgs.WsSendSubscribe).toBeDefined()

      // Schemas have payload types
      const sch = components.schemas as Record<string, Record<string, unknown>>
      expect(sch.WsRecvMessageCreatePayload).toBeDefined()
      expect(sch.WsSendSubscribePayload).toBeDefined()
      expect(sch.WsRecvMessageCreatePayload.type).toBe('object')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('writes WS test files', async () => {
    const { outputBaseDir, outputRoot } = await generateAndParse()
    try {
      const testRaw = await readFile(
        path.join(outputRoot, 'examples', 'ws_recv_message_create.example.json'),
        'utf8',
      )
      const testData = JSON.parse(testRaw) as Record<string, unknown>
      expect(testData.protocol).toBe('ws')
      expect(testData.operation_id).toBe('ws_recv_message_create')
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('validates with minimal server extensions', async () => {
    const minimalExt: XOpenWebWsServer = {
      transport: 'node',
      discriminator: {
        sent: { field: 'type' },
        received: null,
      },
    }

    const ops: WsOperationSchema[] = [
      {
        operationId: 'ws_recv_price',
        pattern: 'stream',
        direction: 'received',
        payloadSchema: { type: 'object', properties: { price: { type: 'number' } } },
      },
    ]

    const { outputBaseDir, spec } = await generateAndParse(ops, minimalExt)
    try {
      const result = validateAsyncApiSpec(spec)
      expect(result.valid).toBe(true)
    } finally {
      await rm(outputBaseDir, { recursive: true, force: true })
    }
  })
})
