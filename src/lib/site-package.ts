import path from 'node:path'

import type { OpenApiSpec, OperationRef, HttpMethod } from './openapi.js'
import { loadOpenApi, listOperations as listHttpOperations, resolveSiteRoot, pathExists } from './openapi.js'
import { loadAsyncApi, listAsyncApiOperations } from './asyncapi.js'
import type { AsyncApiSpec, AsyncApiOperationRef } from './asyncapi.js'
import type { PermissionCategory } from '../types/extensions.js'
import type { WsPattern } from '../types/ws-primitives.js'
import { derivePermissionFromMethod } from './permission-derive.js'

// ── Operation Index Types ───────────────────────────

export interface HttpOperationEntry {
  readonly protocol: 'http'
  readonly operationId: string
  readonly method: HttpMethod
  readonly path: string
  readonly summary?: string
  readonly permission: PermissionCategory
}

export interface WsOperationEntry {
  readonly protocol: 'ws'
  readonly operationId: string
  readonly pattern: WsPattern
  readonly action: 'send' | 'receive'
  readonly summary?: string
  readonly permission: PermissionCategory
}

export type OperationEntry = HttpOperationEntry | WsOperationEntry

// ── Site Package ────────────────────────────────────

export interface SitePackage {
  readonly site: string
  readonly root: string
  readonly openapi?: OpenApiSpec
  readonly asyncapi?: AsyncApiSpec
  readonly operations: ReadonlyMap<string, OperationEntry>
}

export async function loadSitePackage(site: string): Promise<SitePackage> {
  const root = await resolveSiteRoot(site)
  const hasOpenApi = await pathExists(path.join(root, 'openapi.yaml'))
  const hasAsyncApi = await pathExists(path.join(root, 'asyncapi.yaml'))

  let openapi: OpenApiSpec | undefined
  let asyncapi: AsyncApiSpec | undefined

  if (hasOpenApi) {
    openapi = await loadOpenApi(site)
  }

  if (hasAsyncApi) {
    asyncapi = await loadAsyncApi(root)
  }

  const operations = buildOperationIndex(openapi, asyncapi)

  return { site, root, openapi, asyncapi, operations }
}

// ── Index Builder ───────────────────────────────────

function buildOperationIndex(
  openapi: OpenApiSpec | undefined,
  asyncapi: AsyncApiSpec | undefined,
): ReadonlyMap<string, OperationEntry> {
  const index = new Map<string, OperationEntry>()

  if (openapi) {
    for (const ref of listHttpOperations(openapi)) {
      const ext = ref.operation['x-openweb'] as Record<string, unknown> | undefined
      const permission = (ext?.permission as PermissionCategory | undefined)
        ?? derivePermissionFromMethod(ref.method, ref.path) as PermissionCategory
      index.set(ref.operation.operationId, {
        protocol: 'http',
        operationId: ref.operation.operationId,
        method: ref.method,
        path: ref.path,
        summary: ref.operation.summary,
        permission,
      })
    }
  }

  if (asyncapi) {
    for (const ref of listAsyncApiOperations(asyncapi)) {
      const ext = ref.operation['x-openweb']
      index.set(ref.operationId, {
        protocol: 'ws',
        operationId: ref.operationId,
        pattern: ref.pattern,
        action: ref.action,
        summary: ref.summary,
        permission: ext?.permission ?? 'read',
      })
    }
  }

  return index
}

// ── Lookup ──────────────────────────────────────────

export function findOperationEntry(
  pkg: SitePackage,
  operationId: string,
): OperationEntry {
  const entry = pkg.operations.get(operationId)
  if (!entry) {
    const available = Array.from(pkg.operations.keys()).join(', ')
    throw new Error(`Operation not found: ${operationId}. Available: ${available}`)
  }
  return entry
}
