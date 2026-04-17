import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'

import { validateXOpenWebSpec } from '../types/validator.js'
import { OpenWebError } from './errors.js'
import { resolveSiteRoot } from './site-resolver.js'

export type JsonSchema = {
  readonly type?: string | string[]
  readonly items?: JsonSchema
  readonly properties?: Record<string, JsonSchema>
  readonly required?: string[]
  readonly [key: string]: unknown
}

export interface OpenApiParameter {
  readonly name: string
  readonly in: string
  readonly required?: boolean
  readonly description?: string
  readonly schema?: JsonSchema
}

export interface OpenApiRequestBody {
  readonly required?: boolean
  readonly content?: Record<string, { readonly schema?: JsonSchema }>
}

export interface OpenApiServerVariable {
  readonly default: string
  readonly enum?: string[]
  readonly description?: string
}

export interface OpenApiServer {
  readonly url: string
  readonly description?: string
  readonly variables?: Record<string, OpenApiServerVariable>
}

export interface OpenApiOperation {
  readonly operationId: string
  readonly summary?: string
  readonly description?: string
  readonly servers?: OpenApiServer[]
  readonly parameters?: OpenApiParameter[]
  readonly requestBody?: OpenApiRequestBody
  readonly responses?: Record<
    string,
    {
      readonly content?: Record<string, { readonly schema?: JsonSchema }>
    }
  >
  readonly "x-openweb"?: Record<string, unknown>
}

export interface OpenApiSpec {
  readonly openapi: string
  readonly info: {
    readonly title: string
    readonly version: string
    readonly [key: string]: unknown
  }
  readonly servers?: OpenApiServer[]
  readonly paths?: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
}

export interface OperationRef {
  readonly method: HttpMethod
  readonly path: string
  readonly operation: OpenApiOperation
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head'

const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]

export async function loadOpenApi(site: string): Promise<OpenApiSpec> {
  const root = await resolveSiteRoot(site)
  const content = await readFile(`${root}/openapi.yaml`, 'utf8')
  const parsed = parse(content) as OpenApiSpec

  if (!parsed?.openapi || !parsed?.paths) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Invalid OpenAPI spec for site: ${site}`,
      action: `Regenerate the spec for ${site} and retry.`,
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // Validate x-openweb extensions at load time — catches unsupported
  // auth types and unknown fields before they reach runtime
  const validation = validateXOpenWebSpec(parsed)
  if (!validation.valid) {
    const details = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `x-openweb validation failed for ${site}: ${details}`,
      action: 'Fix the x-openweb extensions in the OpenAPI spec.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return parsed
}

export function listOperations(spec: OpenApiSpec): OperationRef[] {
  const operations: OperationRef[] = []

  for (const [apiPath, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods?.[method]
      if (!op?.operationId) {
        continue
      }
      operations.push({
        method,
        path: apiPath,
        operation: op,
      })
    }
  }

  return operations
}

export function findOperation(spec: OpenApiSpec, operationId: string): OperationRef {
  const operation = listOperations(spec).find((entry) => entry.operation.operationId === operationId)
  if (!operation) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'TOOL_NOT_FOUND',
      message: `Tool not found: ${operationId}`,
      action: 'Run `openweb <site>` to list available tools.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // Virtual path support: when the spec key is a virtual path (e.g. GraphQL
  // dedup), the real URL path is stored in x-openweb.actual_path.
  const actualPath = (operation.operation['x-openweb'] as Record<string, unknown> | undefined)?.actual_path
  if (typeof actualPath === 'string') {
    return { ...operation, path: actualPath }
  }

  return operation
}

export function getServerUrl(
  spec: OpenApiSpec,
  operation: OpenApiOperation,
  params?: Record<string, unknown>,
): string {
  const operationServer = operation.servers?.[0]
  if (operationServer) {
    return substituteServerVariables(operationServer, params)
  }

  const globalServer = spec.servers?.[0]
  if (globalServer) {
    return substituteServerVariables(globalServer, params)
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: 'No server URL found in OpenAPI spec.',
    action: 'Add `servers` to the spec and retry.',
    retriable: false,
    failureClass: 'fatal',
  })
}

/**
 * Resolves OpenAPI server variable placeholders: caller-provided param wins,
 * then the variable's `default`. Unknown placeholders are left unchanged.
 */
function substituteServerVariables(
  server: OpenApiServer,
  params: Record<string, unknown> | undefined,
): string {
  return server.url.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const fromParam = params?.[name]
    if (fromParam !== undefined && fromParam !== null) {
      return String(fromParam)
    }
    const fallback = server.variables?.[name]?.default
    return fallback ?? match
  })
}

export function getResponseSchema(operation: OpenApiOperation): JsonSchema | undefined {
  const responses = operation.responses
  if (!responses) return undefined

  // Prefer 200, then any 2xx status code, then 2XX wildcard
  if (responses['200']?.content?.['application/json']?.schema) {
    return responses['200'].content['application/json'].schema
  }
  for (const code of Object.keys(responses)) {
    if (/^2\d{2}$/.test(code)) {
      const schema = responses[code]?.content?.['application/json']?.schema
      if (schema) return schema
    }
  }
  return responses['2XX']?.content?.['application/json']?.schema
}

export function getRequestBodySchema(operation: OpenApiOperation): JsonSchema | undefined {
  return operation.requestBody?.content?.['application/json']?.schema
    ?? operation.requestBody?.content?.['application/x-www-form-urlencoded']?.schema
}

/** Returns the first declared request body content type (json or form-urlencoded). */
export function getRequestBodyContentType(operation: OpenApiOperation): string | undefined {
  const content = operation.requestBody?.content
  if (!content) return undefined
  if (content['application/json']) return 'application/json'
  if (content['application/x-www-form-urlencoded']) return 'application/x-www-form-urlencoded'
  return undefined
}

export function getSchemaTypes(schema: JsonSchema | undefined): string[] {
  if (!schema?.type) {
    return []
  }
  return Array.isArray(schema.type) ? schema.type : [schema.type]
}

export function isObjectSchema(schema: JsonSchema | undefined): schema is JsonSchema {
  return getSchemaTypes(schema).includes('object')
}

export function isArraySchema(schema: JsonSchema | undefined): schema is JsonSchema {
  return getSchemaTypes(schema).includes('array')
}

export function getRequestBodyParameters(operation: OpenApiOperation): OpenApiParameter[] {
  const schema = getRequestBodySchema(operation)
  if (!isObjectSchema(schema)) {
    return []
  }

  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([name, propertySchema]) => ({
    name,
    in: 'body',
    required: required.has(name),
    description: typeof propertySchema?.description === 'string' ? propertySchema.description : undefined,
    schema: propertySchema,
  }))
}
