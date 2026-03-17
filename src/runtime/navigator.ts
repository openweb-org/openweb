import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { getRequestBodyParameters, isArraySchema, type JsonSchema } from '../lib/openapi.js'
import { findOperation, listOperations, loadOpenApi, resolveSiteRoot } from '../lib/openapi.js'
import type { RiskTier } from '../types/extensions.js'
import type { Manifest } from '../types/manifest.js'
import { getServerXOpenWeb, resolveAllParameters, resolveMode } from './session-executor.js'

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

async function loadManifest(site: string): Promise<Manifest | undefined> {
  try {
    const siteRoot = await resolveSiteRoot(site)
    const raw = await readFile(path.join(siteRoot, 'manifest.json'), 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return undefined
  }
}

function getModeLabel(mode: string, hasAdapter: boolean): string {
  return hasAdapter ? 'adapter (L3)' : mode
}

export async function renderSite(site: string): Promise<string> {
  const spec = await loadOpenApi(site)
  const operations = listOperations(spec)
  const manifest = await loadManifest(site)

  if (operations.length === 0) {
    return 'No tools found.'
  }

  const lines: string[] = []

  // Site header with readiness metadata
  const displayName = manifest?.display_name ?? site
  lines.push(`${displayName} (${operations.length} operations)`)
  lines.push('')

  // Derive site-level mode from the first server
  const firstOp = operations[0]
  const serverExt = getServerXOpenWeb(spec, firstOp.operation)
  const siteMode = serverExt?.mode ?? 'direct_http'
  const hasAdapter = operations.some((entry) => {
    const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
    return !!opExt?.adapter
  })
  const requiresBrowser = siteMode !== 'direct_http'
  const requiresAuth = manifest?.requires_auth ?? !!serverExt?.auth

  lines.push(`Mode:             ${getModeLabel(siteMode, hasAdapter)}`)
  lines.push(`Requires browser: ${requiresBrowser ? 'yes' : 'no'}`)
  lines.push(`Requires login:   ${requiresAuth ? 'yes' : 'no'}`)

  // Risk summary
  const riskCounts: Record<string, number> = {}
  for (const entry of operations) {
    const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
    const tier = (opExt?.risk_tier as RiskTier | undefined) ?? 'unknown'
    riskCounts[tier] = (riskCounts[tier] ?? 0) + 1
  }
  const riskParts = Object.entries(riskCounts).map(([tier, count]) => `${tier}:${count}`)
  lines.push(`Risk summary:     ${riskParts.join(' ')}`)

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
  const mode = resolveMode(spec, operation)
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  const modeLabel = getModeLabel(mode, !!opExt?.adapter)

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

  lines.push(`Mode: ${modeLabel}`)

  // Operation-level metadata
  if (opExt?.risk_tier) {
    lines.push(`Risk: ${opExt.risk_tier as string}`)
  }

  if (full) {
    lines.push('')
    lines.push(JSON.stringify(operation, null, 2))
  }

  return lines.join('\n')
}
