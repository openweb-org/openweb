import path from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { getRequestBodyParameters, isArraySchema, type JsonSchema } from '../lib/openapi.js'
import { findOperation, listOperations, loadOpenApi, resolveSiteRoot } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
import { loadSitePackage, type OperationEntry } from '../lib/site-package.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
import type { PermissionCategory } from '../types/extensions.js'
import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import { resolveAllParameters } from './request-builder.js'

function formatParamType(type: string | string[] | undefined): string {
  if (!type) {
    return 'unknown'
  }
  if (Array.isArray(type)) {
    return type.join(' | ')
  }
  if (type === 'array') {
    return 'array'
  }
  return type
}

function summarizeSchema(schema: unknown): string {
  if (!schema || typeof schema !== 'object') {
    return 'unknown'
  }

  const typed = schema as JsonSchema
  if (typed.type === 'array') {
    return `array<${summarizeSchema(typed.items)}>`
  }

  if (typed.type && typed.type !== 'object') {
    return formatParamType(typed.type)
  }

  const keys = Object.keys(typed.properties ?? {})
  if (keys.length === 0) {
    return 'object'
  }

  return `{ ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''} }`
}

function getTransportLabel(transport: string, hasAdapter: boolean): string {
  return hasAdapter ? 'adapter (L3)' : transport
}

/** Read DOC.md safely: reject symlinks, enforce path inside siteRoot, only ignore ENOENT. */
export async function safeReadNotes(siteRoot: string): Promise<string | null> {
  const docPath = path.join(siteRoot, 'DOC.md')

  // Reject symlinks
  const stat = await lstat(docPath)
  if (stat.isSymbolicLink()) return null

  // Enforce resolved path stays inside siteRoot
  const resolved = realpathSync(docPath)
  const canonicalRoot = realpathSync(siteRoot)
  if (!resolved.startsWith(canonicalRoot + path.sep)) return null

  const content = await readFile(docPath, 'utf8')
  return content.split('\n').find(l => l.trim().length > 0)?.trim() ?? null
}

export async function renderSite(site: string): Promise<string> {
  const pkg = await loadSitePackage(site)
  const manifest = await loadManifest(pkg.root)
  const allOps = Array.from(pkg.operations.values())

  if (allOps.length === 0) {
    return 'No tools found.'
  }

  const lines: string[] = []

  // Site header with readiness metadata
  const displayName = manifest?.display_name ?? site
  lines.push(`${displayName} (${allOps.length} operations)`)
  lines.push('')

  // Derive site-level transport from the first HTTP operation's server (if available)
  const httpOps = pkg.openapi ? listOperations(pkg.openapi) : []
  let siteTransport = 'node'
  let requiresBrowser = false
  let hasAdapter = false

  if (httpOps.length > 0 && pkg.openapi) {
    const firstOp = httpOps[0]
    const serverExt = getServerXOpenWeb(pkg.openapi, firstOp.operation)
    siteTransport = serverExt?.transport ?? 'node'
    hasAdapter = httpOps.some((entry) => {
      const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
      return !!opExt?.adapter
    })
    requiresBrowser = siteTransport === 'page' || !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)
  }

  const requiresAuth = manifest?.requires_auth ?? false

  lines.push(`Transport:        ${getTransportLabel(siteTransport, hasAdapter)}`)
  lines.push(`Requires browser: ${requiresBrowser ? 'yes' : 'no'}`)
  lines.push(`Requires login:   ${requiresAuth ? 'yes' : 'no'}`)

  // Permission summary
  const permissionCounts: Record<string, number> = {}
  for (const entry of allOps) {
    permissionCounts[entry.permission] = (permissionCounts[entry.permission] ?? 0) + 1
  }
  const permParts = Object.entries(permissionCounts).map(([perm, count]) => `${perm}:${count}`)
  lines.push(`Permissions:      ${permParts.join(' ')}`)

  // Per-site notes hint
  try {
    const firstLine = await safeReadNotes(pkg.root)
    if (firstLine) {
      lines.push(`Notes:            ${firstLine}`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  lines.push('')
  lines.push('Operations:')

  // Operation list with protocol indicator
  for (const entry of allOps) {
    const proto = entry.protocol === 'ws' ? '[ws] ' : ''
    const summary = entry.summary ?? ''
    lines.push(`  ${proto}${entry.operationId.padEnd(entry.protocol === 'ws' ? 17 : 22)} ${summary}`.trimEnd())
  }

  return lines.join('\n')
}

export async function renderOperation(site: string, operationId: string, full: boolean): Promise<string> {
  const pkg = await loadSitePackage(site)
  const entry = pkg.operations.get(operationId)

  // WS operation rendering
  if (entry?.protocol === 'ws') {
    const wsEntry = entry as import('../lib/site-package.js').WsOperationEntry
    const lines: string[] = []
    lines.push(`WS ${wsEntry.action} (${wsEntry.pattern})`)
    if (wsEntry.summary) {
      lines.push(wsEntry.summary)
    }
    lines.push("Transport: node")
    lines.push(`Permission: ${wsEntry.permission}`)
    lines.push("Protocol: ws")

    if (full && pkg.asyncapi?.operations?.[operationId]) {
      lines.push('')
      lines.push(JSON.stringify(pkg.asyncapi.operations[operationId], null, 2))
    }

    return lines.join('\n')
  }

  // HTTP operation rendering (existing logic)
  const spec = await loadOpenApi(site)
  const { method, path: opPath, operation } = findOperation(spec, operationId)
  const transport = resolveTransport(spec, operation)
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  const transportLabel = getTransportLabel(transport, !!opExt?.adapter)

  const lines: string[] = []
  lines.push(`${method.toUpperCase()} ${opPath}`)

  // Show all parameter types grouped by location (resolves $ref components)
  const allParams = resolveAllParameters(spec, operation)
  const paramGroups = ['path', 'query', 'header'] as const
  for (const location of paramGroups) {
    const params = allParams.filter((p) => p.in === location)
    if (params.length === 0) continue
    for (const parameter of params) {
      const itemType = isArraySchema(parameter.schema) ? `${formatParamType(parameter.schema?.items?.type)}[]` : formatParamType(parameter.schema?.type)
      const required = parameter.required ? '[required]' : ''
      const loc = location === 'query' ? '' : `[${location}] `
      const desc = parameter.description ?? ''
      lines.push(`  ${parameter.name.padEnd(12)} ${itemType.padEnd(9)} ${loc}${desc} ${required}`.trimEnd())
    }
  }

  const bodyParams = getRequestBodyParameters(operation)
  if (bodyParams.length > 0) {
    lines.push('Body:')
    for (const parameter of bodyParams) {
      const itemType = isArraySchema(parameter.schema) ? `${formatParamType(parameter.schema?.items?.type)}[]` : formatParamType(parameter.schema?.type)
      const required = parameter.required ? '[required]' : ''
      const desc = parameter.description ?? ''
      lines.push(`  ${parameter.name.padEnd(12)} ${itemType.padEnd(9)} ${desc} ${required}`.trimEnd())
    }
  }

  const responseSchema = operation.responses?.['200']?.content?.['application/json']?.schema
  if (responseSchema) {
    lines.push(`Returns: ${summarizeSchema(responseSchema)}`)
  }

  lines.push(`Transport: ${transportLabel}`)

  // Operation-level metadata
  const effectivePerm = (opExt?.permission as string | undefined) ?? derivePermissionFromMethod(method, opPath)
  lines.push(`Permission: ${effectivePerm}`)

  if (full) {
    lines.push('')
    lines.push(JSON.stringify(operation, null, 2))
  }

  return lines.join('\n')
}

export async function renderSiteJson(site: string): Promise<string> {
  const pkg = await loadSitePackage(site)
  const manifest = await loadManifest(pkg.root)
  const allOps = Array.from(pkg.operations.values())

  // Check for DOC.md
  let hasNotes = false
  try {
    hasNotes = (await safeReadNotes(pkg.root)) !== null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const result = {
    name: manifest?.display_name ?? site,
    hasNotes,
    operations: allOps.map((entry) => {
      if (entry.protocol === 'ws') {
        return {
          id: entry.operationId,
          protocol: 'ws' as const,
          pattern: entry.pattern,
          permission: entry.permission,
          summary: entry.summary ?? '',
        }
      }
      return {
        id: entry.operationId,
        protocol: 'http' as const,
        method: entry.method.toUpperCase(),
        path: entry.path,
        permission: entry.permission,
        summary: entry.summary ?? '',
      }
    }),
  }

  return JSON.stringify(result)
}

export async function renderOperationJson(site: string, operationId: string): Promise<string> {
  const pkg = await loadSitePackage(site)
  const entry = pkg.operations.get(operationId)

  if (entry?.protocol === 'ws') {
    const wsEntry = entry as import('../lib/site-package.js').WsOperationEntry
    return JSON.stringify({
      id: operationId,
      protocol: 'ws',
      pattern: wsEntry.pattern,
      permission: wsEntry.permission,
      parameters: [],
    })
  }

  // HTTP operation (existing logic)
  const spec = await loadOpenApi(site)
  const { method, path: opPath, operation } = findOperation(spec, operationId)
  const allParams = resolveAllParameters(spec, operation)
  const bodyParams = getRequestBodyParameters(operation)
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined

  return JSON.stringify({
    id: operationId,
    protocol: 'http',
    method: method.toUpperCase(),
    path: opPath,
    permission: (opExt?.permission as string | undefined) ?? derivePermissionFromMethod(method, opPath),
    parameters: [...allParams, ...bodyParams].map((p) => ({
      name: p.name,
      in: p.in,
      required: !!p.required,
      type: formatParamType(p.schema?.type),
      default: p.schema?.default,
    })),
  })
}

/** Generate example params JSON from schema defaults and parameter names */
export async function renderExample(site: string, operationId: string): Promise<string> {
  const spec = await loadOpenApi(site)
  const { operation } = findOperation(spec, operationId)
  const allParams = resolveAllParameters(spec, operation)
  const bodyParams = getRequestBodyParameters(operation)

  const example: Record<string, unknown> = {}

  for (const p of [...allParams, ...bodyParams]) {
    // Skip header params with defaults (auto-injected)
    if (p.in === 'header' && p.schema?.default !== undefined) continue

    if (p.schema?.default !== undefined) {
      example[p.name] = p.schema.default
    } else if (p.schema?.const !== undefined) {
    } else {
      // Generate a placeholder based on type
      const type = typeof p.schema?.type === 'string' ? p.schema.type : 'string'
      if (type === 'integer' || type === 'number') {
        example[p.name] = 0
      } else if (type === 'boolean') {
        example[p.name] = false
      } else if (type === 'array') {
        example[p.name] = []
      } else {
        example[p.name] = `<${p.name}>`
      }
    }
  }

  return JSON.stringify(example, null, 2)
}
