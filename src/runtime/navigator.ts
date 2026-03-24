import path from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { getRequestBodyParameters, isArraySchema, type JsonSchema } from '../lib/openapi.js'
import { findOperation, listOperations, loadOpenApi, resolveSiteRoot } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
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
  const spec = await loadOpenApi(site)
  const operations = listOperations(spec)
  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)

  if (operations.length === 0) {
    return 'No tools found.'
  }

  const lines: string[] = []

  // Site header with readiness metadata
  const displayName = manifest?.display_name ?? site
  lines.push(`${displayName} (${operations.length} operations)`)
  lines.push('')

  // Derive site-level transport from the first server
  const firstOp = operations[0]
  const serverExt = getServerXOpenWeb(spec, firstOp.operation)
  const siteTransport = serverExt?.transport ?? 'node'
  const hasAdapter = operations.some((entry) => {
    const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
    return !!opExt?.adapter
  })
  const requiresBrowser = siteTransport === 'page' || !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)
  const requiresAuth = manifest?.requires_auth ?? !!serverExt?.auth

  lines.push(`Transport:        ${getTransportLabel(siteTransport, hasAdapter)}`)
  lines.push(`Requires browser: ${requiresBrowser ? 'yes' : 'no'}`)
  lines.push(`Requires login:   ${requiresAuth ? 'yes' : 'no'}`)

  // Permission summary
  const permissionCounts: Record<string, number> = {}
  for (const entry of operations) {
    const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
    const perm = (opExt?.permission as PermissionCategory | undefined) ?? derivePermissionFromMethod(entry.method, entry.path) as PermissionCategory
    permissionCounts[perm] = (permissionCounts[perm] ?? 0) + 1
  }
  const permParts = Object.entries(permissionCounts).map(([perm, count]) => `${perm}:${count}`)
  lines.push(`Permissions:      ${permParts.join(' ')}`)

  // Per-site notes hint
  try {
    const firstLine = await safeReadNotes(siteRoot)
    if (firstLine) {
      lines.push(`Notes:            ${firstLine}`)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  lines.push('')
  lines.push('Operations:')

  // Operation list
  for (const entry of operations) {
    const id = entry.operation.operationId
    const summary = entry.operation.summary ?? ''
    lines.push(`  ${id.padEnd(22)} ${summary}`.trimEnd())
  }

  return lines.join('\n')
}

export async function renderOperation(site: string, operationId: string, full: boolean): Promise<string> {
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
  const spec = await loadOpenApi(site)
  const operations = listOperations(spec)
  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)

  // Check for DOC.md
  let hasNotes = false
  try {
    hasNotes = (await safeReadNotes(siteRoot)) !== null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const result = {
    name: manifest?.display_name ?? site,
    hasNotes,
    operations: operations.map((entry) => {
      const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
      return {
        id: entry.operation.operationId,
        method: entry.method.toUpperCase(),
        path: entry.path,
        permission: (opExt?.permission as string | undefined) ?? derivePermissionFromMethod(entry.method, entry.path),
        summary: entry.operation.summary ?? '',
      }
    }),
  }

  return JSON.stringify(result)
}

export async function renderOperationJson(site: string, operationId: string): Promise<string> {
  const spec = await loadOpenApi(site)
  const { method, path: opPath, operation } = findOperation(spec, operationId)
  const allParams = resolveAllParameters(spec, operation)
  const bodyParams = getRequestBodyParameters(operation)
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined

  const result = {
    id: operationId,
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
  }

  return JSON.stringify(result)
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
      continue // const params are auto-filled
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
