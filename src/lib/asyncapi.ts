import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

import { OpenWebError } from './errors.js'
import { validateAsyncApiSpec } from '../types/validator.js'
import type { XOpenWebWsOperation } from '../types/ws-extensions.js'
import type { XOpenWebWsServer } from '../types/ws-extensions.js'
import type { WsPattern } from '../types/ws-primitives.js'

// ── AsyncAPI Spec Types ─────────────────────────────

export interface AsyncApiServer {
  readonly host: string
  readonly pathname?: string
  readonly protocol: string
  readonly 'x-openweb'?: XOpenWebWsServer
}

export interface AsyncApiMessage {
  readonly payload?: unknown
  readonly '$ref'?: string
}

export interface AsyncApiChannel {
  readonly address?: string
  readonly servers?: ReadonlyArray<{ readonly '$ref': string }>
  readonly messages?: Readonly<Record<string, AsyncApiMessage>>
}

export interface AsyncApiOperation {
  readonly operationId?: string
  readonly action: 'send' | 'receive'
  readonly channel?: { readonly '$ref': string }
  readonly summary?: string
  readonly description?: string
  readonly 'x-openweb'?: XOpenWebWsOperation
  readonly messages?: ReadonlyArray<{ readonly '$ref': string }>
}

export interface AsyncApiSpec {
  readonly asyncapi: string
  readonly info: {
    readonly title: string
    readonly version: string
    readonly 'x-openweb'?: Record<string, unknown>
  }
  readonly servers?: Readonly<Record<string, AsyncApiServer>>
  readonly channels?: Readonly<Record<string, AsyncApiChannel>>
  readonly operations?: Readonly<Record<string, AsyncApiOperation>>
  readonly components?: {
    readonly messages?: Readonly<Record<string, unknown>>
    readonly schemas?: Readonly<Record<string, unknown>>
  }
}

export interface AsyncApiOperationRef {
  readonly operationId: string
  readonly action: 'send' | 'receive'
  readonly pattern: WsPattern
  readonly summary?: string
  readonly operation: AsyncApiOperation
}

// ── Parsing ─────────────────────────────────────────

export function parseAsyncApiSpec(yamlContent: string): AsyncApiSpec {
  const parsed = parse(yamlContent) as AsyncApiSpec

  if (!parsed?.asyncapi) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Invalid AsyncAPI spec: missing asyncapi version field',
      action: 'Regenerate the AsyncAPI spec and retry.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const validation = validateAsyncApiSpec(parsed)
  if (!validation.valid) {
    const details = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `AsyncAPI validation failed: ${details}`,
      action: 'Fix the AsyncAPI spec.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return parsed
}

// ── Loading ─────────────────────────────────────────

export async function loadAsyncApi(siteRoot: string): Promise<AsyncApiSpec> {
  const content = await readFile(path.join(siteRoot, 'asyncapi.yaml'), 'utf8')
  return parseAsyncApiSpec(content)
}

// ── Operation Extraction ────────────────────────────

export function listAsyncApiOperations(spec: AsyncApiSpec): AsyncApiOperationRef[] {
  const result: AsyncApiOperationRef[] = []

  for (const [opId, op] of Object.entries(spec.operations ?? {})) {
    const ext = op['x-openweb']
    result.push({
      operationId: opId,
      action: op.action,
      pattern: ext?.pattern ?? 'stream',
      summary: op.summary,
      operation: op,
    })
  }

  return result
}
