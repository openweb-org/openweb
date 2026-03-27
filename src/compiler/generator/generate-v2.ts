import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { stringify } from 'yaml'

import { TIMEOUT } from '../../lib/config.js'
import type { PermissionCategory } from '../../types/extensions.js'
import type {
  CuratedCompilePlan,
  CuratedOperation,
  ResponseVariant,
} from '../types-v2.js'

// ── Output types ─────────────────────────────────────

export interface GeneratedPackage {
  readonly outputRoot: string
  readonly files: readonly string[]
}

// ── Helpers ──────────────────────────────────────────

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Map replaySafety to x-openweb risk_tier. */
function riskTier(safety: CuratedOperation['replaySafety']): string {
  return safety === 'safe_read' ? 'safe' : 'unsafe'
}

function choosePrimaryHost(operations: readonly CuratedOperation[], fallbackUrl?: string): string {
  const counts = new Map<string, number>()
  for (const op of operations) {
    counts.set(op.host, (counts.get(op.host) ?? 0) + 1)
  }

  const fallbackHost = fallbackUrl ? new URL(fallbackUrl).hostname : 'api.example.com'
  let best = operations[0]?.host ?? fallbackHost
  let bestCount = -1

  for (const [host, count] of counts.entries()) {
    if (count > bestCount) {
      best = host
      bestCount = count
    }
  }
  return best
}

function toPascalCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function parseWsUrl(url: string): { host: string; pathname: string } {
  const parsed = new URL(url)
  return { host: parsed.host, pathname: parsed.pathname || '/' }
}

function wsServerName(host: string): string {
  return host.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
}

/** Describe an HTTP status code for OpenAPI response descriptions. */
function statusDescription(status: number): string {
  if (status >= 200 && status < 300) return 'Success.'
  if (status === 401) return 'Authentication required.'
  if (status === 403) return 'Forbidden.'
  if (status === 404) return 'Not found.'
  if (status === 429) return 'Rate limited.'
  if (status >= 400 && status < 500) return 'Client error.'
  if (status >= 500) return 'Server error.'
  return 'Response.'
}

/** Build OpenAPI responses object from all response variants. */
function buildResponses(variants: readonly ResponseVariant[]): {
  responses: Record<string, unknown>
  primaryStatus: number
} {
  if (variants.length === 0) {
    return {
      responses: { '200': { description: 'Success.', content: { 'application/json': { schema: { type: 'object' } } } } },
      primaryStatus: 200,
    }
  }

  // Group variants by status code
  const byStatus = new Map<number, ResponseVariant[]>()
  for (const v of variants) {
    const group = byStatus.get(v.status) ?? []
    group.push(v)
    byStatus.set(v.status, group)
  }

  const responses: Record<string, unknown> = {}
  for (const [status, group] of byStatus) {
    const content: Record<string, unknown> = {}
    for (const v of group) {
      content[v.contentType] = { schema: v.schema ?? { type: 'object' } }
    }
    responses[String(status)] = {
      description: statusDescription(status),
      content,
    }
  }

  // Primary status: prefer 2xx, then lowest status
  const statuses = [...byStatus.keys()].sort((a, b) => a - b)
  const primaryStatus = statuses.find((s) => s >= 200 && s < 300) ?? statuses[0] ?? 200

  return { responses, primaryStatus }
}

/** Ensure every operationId in the list is unique by appending _2, _3, etc. */
function deduplicateOperationIds(operations: readonly CuratedOperation[]): Map<string, string> {
  const counts = new Map<string, number>()
  const result = new Map<string, string>()

  for (const op of operations) {
    const base = op.operationId
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    result.set(op.id, seen === 0 ? base : `${base}_${seen + 1}`)
  }

  return result
}

// ── OpenAPI emission ─────────────────────────────────

async function emitOpenApi(
  plan: CuratedCompilePlan,
  outputRoot: string,
  generatedAt: string,
): Promise<string[]> {
  if (plan.operations.length === 0) return []

  const testsDir = path.join(outputRoot, 'tests')
  await mkdir(testsDir, { recursive: true })

  const primaryHost = choosePrimaryHost(plan.operations, plan.sourceUrl)
  const requiresAuth = !!(plan.context.auth || plan.context.csrf || plan.context.signing)

  const paths: Record<string, Record<string, unknown>> = {}
  const files: string[] = ['openapi.yaml', 'manifest.json']

  const uniqueIds = deduplicateOperationIds(plan.operations)

  for (const op of plan.operations) {
    const operationId = uniqueIds.get(op.id) ?? op.operationId
    const method = op.method.toLowerCase()
    const stableId = hash16(`${operationId}:${method}:${op.pathTemplate}`)

    const xOpenweb: Record<string, unknown> = {
      permission: op.permission,
      risk_tier: riskTier(op.replaySafety),
      build: {
        stable_id: stableId,
        tool_version: 2,
      },
    }

    const { responses, primaryStatus } = buildResponses(op.responseVariants)

    const operationObject: Record<string, unknown> = {
      operationId,
      summary: op.summary,
      'x-openweb': xOpenweb,
      parameters: op.parameters.map((p) => ({
        name: p.name,
        in: p.location,
        required: p.required,
        schema: p.schema,
        description: p.description,
      })),
      responses,
    }

    if (op.requestBodySchema) {
      const bodyContent: Record<string, unknown> = { schema: op.requestBodySchema }
      if (op.exampleRequestBody !== undefined) {
        bodyContent.example = op.exampleRequestBody
      }
      operationObject.requestBody = {
        required: true,
        content: { 'application/json': bodyContent },
      }
    }

    if (op.host !== primaryHost) {
      operationObject.servers = [{ url: `https://${op.host}` }]
    }

    if (!paths[op.pathTemplate]) paths[op.pathTemplate] = {}
    ;(paths[op.pathTemplate] as Record<string, unknown>)[method] = operationObject

    // Test file — uses scrubbed examples from curation, never raw PII
    const testShape = {
      operation_id: operationId,
      method,
      ...(op.exampleRequestBody !== undefined ? { request_body: op.exampleRequestBody } : {}),
      cases: [
        {
          input: op.exampleInput,
          assertions: { status: primaryStatus, response_schema_valid: true },
        },
      ],
    }

    const testFile = `tests/${operationId}.test.json`
    await writeFile(path.join(outputRoot, testFile), `${JSON.stringify(testShape, null, 2)}\n`, 'utf8')
    files.push(testFile)
  }

  // Server entry with auth/csrf/signing from CuratedSiteContext
  const serverEntry: Record<string, unknown> = { url: `https://${primaryHost}` }
  if (plan.context.auth || plan.context.csrf || plan.context.signing) {
    const serverXOpenWeb: Record<string, unknown> = { transport: plan.context.transport }
    if (plan.context.auth) serverXOpenWeb.auth = plan.context.auth
    if (plan.context.csrf) serverXOpenWeb.csrf = plan.context.csrf
    if (plan.context.signing) serverXOpenWeb.signing = plan.context.signing
    serverEntry['x-openweb'] = serverXOpenWeb
  }

  const infoXOpenweb: Record<string, unknown> = {
    spec_version: '2.0',
    compiled_at: generatedAt,
    requires_auth: requiresAuth,
  }
  if (plan.extractionSignals && plan.extractionSignals.length > 0) {
    infoXOpenweb.extraction_signals = plan.extractionSignals
  }

  const openapi = {
    openapi: '3.1.0',
    info: {
      title: plan.site,
      version: '1.0.0',
      'x-openweb': infoXOpenweb,
    },
    servers: [serverEntry],
    paths,
  }

  const manifest = {
    name: plan.site,
    version: '1.0.0',
    spec_version: '2.0',
    site_url: plan.sourceUrl,
    compiled_at: generatedAt,
    requires_auth: requiresAuth,
  }

  await writeFile(path.join(outputRoot, 'openapi.yaml'), stringify(openapi), 'utf8')
  await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return files
}

// ── AsyncAPI emission ────────────────────────────────

async function emitAsyncApi(
  plan: CuratedCompilePlan,
  outputRoot: string,
  generatedAt: string,
): Promise<string[]> {
  const wsPlan = plan.ws
  if (!wsPlan || wsPlan.operations.length === 0) return []

  const testsDir = path.join(outputRoot, 'tests')
  await mkdir(testsDir, { recursive: true })

  const { host, pathname } = parseWsUrl(wsPlan.serverUrl)
  const srvName = wsServerName(host)

  // Server extensions — includes heartbeat (fixes G-10)
  const serverXOpenWeb: Record<string, unknown> = {
    transport: plan.context.transport,
  }
  if (wsPlan.heartbeat) serverXOpenWeb.heartbeat = wsPlan.heartbeat

  const serverEntry: Record<string, unknown> = {
    host,
    pathname,
    protocol: 'wss',
    'x-openweb': serverXOpenWeb,
  }

  const channels: Record<string, unknown> = {}
  const operations: Record<string, unknown> = {}
  const messages: Record<string, unknown> = {}
  const schemas: Record<string, unknown> = {}
  const channelMessages: Record<string, unknown> = {}
  const files: string[] = ['asyncapi.yaml']

  for (const op of wsPlan.operations) {
    const msgName = toPascalCase(op.name)
    const schemaName = `${msgName}Payload`

    schemas[schemaName] = { type: 'object' }
    messages[msgName] = { payload: { $ref: `#/components/schemas/${schemaName}` } }
    channelMessages[op.id] = { $ref: `#/components/messages/${msgName}` }

    // Derive action and permission from pattern
    const action = op.pattern === 'stream' ? 'receive' : 'send'
    const permission: PermissionCategory = action === 'send' ? 'write' : 'read'
    const stableId = hash16(`${op.id}:${wsPlan.serverUrl}`)

    operations[op.id] = {
      action,
      channel: { $ref: `#/channels/${srvName}` },
      'x-openweb': {
        permission,
        pattern: op.pattern,
        build: { stable_id: stableId },
      },
      messages: [{ $ref: `#/channels/${srvName}/messages/${op.id}` }],
    }

    // Test record
    const mode = op.pattern === 'request_reply' || op.pattern === 'publish' ? 'unary' : 'stream'
    const assertions: Record<string, unknown> = { connected: true }
    if (op.pattern !== 'publish') {
      assertions.first_message_within_ms = 5000
      assertions.message_schema_valid = true
    }

    const testShape = {
      operation_id: op.id,
      protocol: 'ws',
      mode,
      cases: [{ input: {}, timeout_ms: TIMEOUT.asyncapiDefault, assertions }],
    }

    const testFile = `tests/${op.id}.test.json`
    await writeFile(path.join(outputRoot, testFile), `${JSON.stringify(testShape, null, 2)}\n`, 'utf8')
    files.push(testFile)
  }

  channels[srvName] = {
    address: pathname,
    servers: [{ $ref: `#/servers/${srvName}` }],
    messages: channelMessages,
  }

  const spec = {
    asyncapi: '3.0.0',
    info: {
      title: `${plan.site} WebSocket API`,
      version: '1.0.0',
      'x-openweb': {
        spec_version: '2.0',
        compiled_at: generatedAt,
      },
    },
    servers: { [srvName]: serverEntry },
    channels,
    operations,
    components: { messages, schemas },
  }

  await writeFile(path.join(outputRoot, 'asyncapi.yaml'), stringify(spec), 'utf8')

  return files
}

// ── Main entry point ─────────────────────────────────

export async function generateFromPlan(
  plan: CuratedCompilePlan,
  outputBaseDir?: string,
): Promise<GeneratedPackage> {
  const base = outputBaseDir ?? path.join(os.homedir(), '.openweb', 'sites')
  const outputRoot = path.join(base, plan.site)
  await mkdir(outputRoot, { recursive: true })

  const generatedAt = new Date().toISOString()

  const httpFiles = await emitOpenApi(plan, outputRoot, generatedAt)
  const wsFiles = await emitAsyncApi(plan, outputRoot, generatedAt)

  return {
    outputRoot,
    files: [...httpFiles, ...wsFiles],
  }
}
