import { createHash } from 'node:crypto'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { stringify } from 'yaml'

import type { WsOperationSchema } from '../ws-analyzer/ws-schema.js'
import type { XOpenWebWsServer } from '../../types/ws-extensions.js'

// ── Input types ──────────────────────────────────────────────

export interface GenerateAsyncApiInput {
  readonly site: string
  readonly serverUrl: string
  readonly serverExtensions: XOpenWebWsServer
  readonly operations: WsOperationSchema[]
  readonly outputRoot: string
  readonly generatedAt: string
}

// ── Helpers ──────────────────────────────────────────────────

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function toPascalCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function parseWsUrl(url: string): { host: string; pathname: string } {
  const parsed = new URL(url)
  return {
    host: parsed.host,
    pathname: parsed.pathname || '/',
  }
}

function serverName(host: string): string {
  return host.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
}

// ── Main entry ──────────────────────────────────────────────

export async function generateAsyncApi(input: GenerateAsyncApiInput): Promise<void> {
  const testsDir = path.join(input.outputRoot, 'tests')
  await mkdir(testsDir, { recursive: true })

  const { host, pathname } = parseWsUrl(input.serverUrl)
  const srvName = serverName(host)

  // Build server entry
  const serverEntry: Record<string, unknown> = {
    host,
    pathname,
    protocol: 'wss',
    'x-openweb': input.serverExtensions,
  }

  // Build channels, operations, messages, schemas
  const channels: Record<string, unknown> = {}
  const operations: Record<string, unknown> = {}
  const messages: Record<string, unknown> = {}
  const schemas: Record<string, unknown> = {}

  // Single channel for all operations on this server
  const channelName = srvName
  const channelMessages: Record<string, unknown> = {}

  for (const op of input.operations) {
    const msgName = toPascalCase(op.operationId)
    const schemaName = `${msgName}Payload`
    const msgKey = op.operationId

    // Schema
    schemas[schemaName] = op.payloadSchema

    // Message
    messages[msgName] = {
      payload: { $ref: `#/components/schemas/${schemaName}` },
    }

    // Channel message ref
    channelMessages[msgKey] = { $ref: `#/components/messages/${msgName}` }

    // Operation
    const action = op.direction === 'sent' ? 'send' : 'receive'
    const permission = op.direction === 'sent' ? 'write' : 'read'
    const stableId = hash16(`${op.operationId}:${input.serverUrl}`)

    const xOpenweb: Record<string, unknown> = {
      permission,
      pattern: op.pattern,
      build: {
        verified: false,
        stable_id: stableId,
      },
    }

    if (op.messageTemplate) {
      xOpenweb.subscribe_message = op.messageTemplate
    }

    operations[op.operationId] = {
      action,
      channel: { $ref: `#/channels/${channelName}` },
      'x-openweb': xOpenweb,
      messages: [{ $ref: `#/channels/${channelName}/messages/${msgKey}` }],
    }

    // Test record
    const testShape: Record<string, unknown> = {
      operation_id: op.operationId,
      protocol: 'ws',
      mode: op.pattern === 'request_reply' ? 'unary' : 'stream',
      cases: [
        {
          input: {},
          timeout_ms: 10000,
          assertions: {
            connected: true,
            first_message_within_ms: 5000,
            message_schema_valid: true,
          },
        },
      ],
    }

    await writeFile(
      path.join(testsDir, `${op.operationId}.test.json`),
      `${JSON.stringify(testShape, null, 2)}\n`,
      'utf8',
    )
  }

  channels[channelName] = {
    address: pathname,
    servers: [{ $ref: `#/servers/${srvName}` }],
    messages: channelMessages,
  }

  const spec = {
    asyncapi: '3.0.0',
    info: {
      title: `${input.site} WebSocket API`,
      version: '1.0.0',
      'x-openweb': {
        spec_version: '2.0',
        compiled_at: input.generatedAt,
      },
    },
    servers: { [srvName]: serverEntry },
    channels,
    operations,
    components: {
      messages,
      schemas,
    },
  }

  await writeFile(path.join(input.outputRoot, 'asyncapi.yaml'), stringify(spec), 'utf8')
}
