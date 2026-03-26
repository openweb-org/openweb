import type { PaginationPrimitive } from '../types/primitives.js'
import type { ExecuteDependencies, ExecuteResult } from './executor.js'
import { OpenWebError } from '../lib/errors.js'
import { findOperation, loadOpenApi, type OpenApiParameter } from '../lib/openapi.js'
import { getValueAtPath, setValueAtPath } from './value-path.js'

const MAX_PAGES = 10

export interface PaginateOptions {
  readonly maxPages?: number
  readonly deps?: ExecuteDependencies
}

export interface PaginatedResult {
  readonly items: unknown[]
  readonly pages: number
}

/**
 * Parse Link header (RFC 8288) and extract URL for given rel.
 * Example: `<https://api.example.com/items?page=2>; rel="next"`
 */
export function parseLinkHeader(header: string, rel = 'next'): string | undefined {
  for (const part of header.split(',')) {
    const urlMatch = part.match(/<([^>]+)>/)
    if (!urlMatch) continue
    if (part.includes(`rel="${rel}"`)) return urlMatch[1]
  }
  return undefined
}

/**
 * Try to extract an array of items from a response body.
 * Checks common wrapper fields: items, data, results.
 * Falls back to the body itself if it's an array, or wraps it in one.
 */
function extractItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const key of ['items', 'data', 'results', 'feed']) {
      if (Array.isArray(record[key])) return record[key] as unknown[]
    }
  }

  return body === undefined || body === null ? [] : [body]
}

/**
 * Execute an operation with automatic pagination.
 * Reads x-openweb.pagination config from the operation's spec.
 * Supported types: cursor, link_header.
 */
export async function executePaginated(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  opts: PaginateOptions = {},
): Promise<PaginatedResult> {
  const { executeOperation } = await import('./executor.js')

  const spec = await loadOpenApi(site)
  const operationRef = findOperation(spec, operationId)
  const xopenweb = operationRef.operation['x-openweb'] as Record<string, unknown> | undefined
  const pagination = xopenweb?.pagination as PaginationPrimitive | undefined

  if (!pagination) {
    const result = await executeOperation(site, operationId, params, opts.deps)
    return { items: extractItems(result.body), pages: 1 }
  }

  const maxPages = opts.maxPages ?? MAX_PAGES

  switch (pagination.type) {
    case 'cursor':
      return executeCursorPagination(site, operationId, params, pagination, maxPages, opts.deps)
    case 'link_header':
      return executeLinkHeaderPagination(site, operationId, params, pagination, maxPages, operationRef.operation.parameters ?? [], opts.deps)
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported pagination type: ${(pagination as { type: string }).type}`,
        action: 'Only cursor and link_header pagination are currently supported.',
        retriable: false,
        failureClass: 'fatal',
      })
  }
}

async function executeCursorPagination(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  config: Extract<PaginationPrimitive, { type: 'cursor' }>,
  maxPages: number,
  deps?: ExecuteDependencies,
): Promise<PaginatedResult> {
  const { executeOperation } = await import('./executor.js')
  const allItems: unknown[] = []
  let currentParams = { ...params }
  let pages = 0

  for (let i = 0; i < maxPages; i++) {
    const result = await executeOperation(site, operationId, currentParams, deps)
    pages++

    const items = config.items_path
      ? (getValueAtPath(result.body, config.items_path) as unknown[] ?? [])
      : extractItems(result.body)
    allItems.push(...(Array.isArray(items) ? items : []))

    const cursor = getValueAtPath(result.body, config.response_field)
    if (cursor === undefined || cursor === null || cursor === '') break

    if (config.has_more_field && !getValueAtPath(result.body, config.has_more_field)) {
      break
    }

    currentParams = setValueAtPath(currentParams, config.request_param, cursor)
  }

  return { items: allItems, pages }
}

/** Coerce a string value to match a declared parameter type (integer, number). */
function coerceParamType(value: string, paramSchema: OpenApiParameter | undefined): unknown {
  const schemaType = paramSchema?.schema?.type
  if (schemaType === 'integer') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? value : parsed
  }
  if (schemaType === 'number') {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? value : parsed
  }
  return value
}

async function executeLinkHeaderPagination(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  config: Extract<PaginationPrimitive, { type: 'link_header' }>,
  maxPages: number,
  declaredParams: readonly OpenApiParameter[],
  deps?: ExecuteDependencies,
): Promise<PaginatedResult> {
  const { executeOperation } = await import('./executor.js')
  const allItems: unknown[] = []
  let currentParams = { ...params }
  let pages = 0

  // Build a lookup from param name → schema for type coercion
  const paramByName = new Map(declaredParams.map((p) => [p.name, p]))

  for (let i = 0; i < maxPages; i++) {
    const result: ExecuteResult = await executeOperation(site, operationId, currentParams, deps)
    pages++
    allItems.push(...extractItems(result.body))

    const linkHeader = result.responseHeaders?.link
    if (!linkHeader) break

    const nextUrl = parseLinkHeader(linkHeader, config.rel ?? 'next')
    if (!nextUrl) break

    // Extract query params from the next URL, coercing to declared types
    const url = new URL(nextUrl)
    const nextParams: Record<string, unknown> = { ...params }
    url.searchParams.forEach((value, key) => {
      nextParams[key] = coerceParamType(value, paramByName.get(key))
    })
    currentParams = nextParams
  }

  return { items: allItems, pages }
}
