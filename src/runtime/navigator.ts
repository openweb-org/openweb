import type { JsonSchema } from '../lib/openapi.js'
import { findOperation, listOperations, loadOpenApi } from '../lib/openapi.js'

function formatParamType(type: string | undefined): string {
  if (!type) {
    return 'unknown'
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
  const keys = Object.keys(typed.properties ?? {})
  if (keys.length === 0) {
    return 'object'
  }

  return `{ ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''} }`
}

export async function renderSite(site: string): Promise<string> {
  const spec = await loadOpenApi(site)
  const operations = listOperations(spec)

  if (operations.length === 0) {
    return 'No tools found.'
  }

  return operations
    .map((entry) => {
      const id = entry.operation.operationId
      const summary = entry.operation.summary ?? ''
      return `${id.padEnd(22)} ${summary}`.trimEnd()
    })
    .join('\n')
}

export async function renderOperation(site: string, operationId: string, full: boolean): Promise<string> {
  const spec = await loadOpenApi(site)
  const { method, path, operation } = findOperation(spec, operationId)

  const lines: string[] = []
  lines.push(`${method.toUpperCase()} ${path}`)

  const queryParams = (operation.parameters ?? []).filter((parameter) => parameter.in === 'query')
  for (const parameter of queryParams) {
    const itemType = parameter.schema?.type === 'array' ? `${parameter.schema.items?.type ?? 'unknown'}[]` : formatParamType(parameter.schema?.type)
    const required = parameter.required ? '[required]' : ''
    const desc = parameter.description ?? ''
    lines.push(`  ${parameter.name.padEnd(12)} ${itemType.padEnd(9)} ${desc} ${required}`.trimEnd())
  }

  const responseSchema = operation.responses?.['200']?.content?.['application/json']?.schema
  if (responseSchema) {
    lines.push(`Returns: ${summarizeSchema(responseSchema)}`)
  }

  const mode = (operation['x-openweb']?.mode as string | undefined) ?? 'unknown'
  lines.push(`Mode: ${mode}`)

  if (full) {
    lines.push('')
    lines.push(JSON.stringify(operation, null, 2))
  }

  return lines.join('\n')
}
