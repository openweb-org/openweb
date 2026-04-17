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

/** Substitute {var} tokens in the first spec-level server URL using defaults.
 *  Used by helpers that don't have an operation context (e.g. cookie
 *  domain derivation). Returns undefined when no servers are declared. */
export function getSpecDefaultServerUrl(spec: OpenApiSpec): string | undefined {
  const server = spec.servers?.[0]
  if (!server) return undefined
  return substituteServerVariables(server, undefined)
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
 * then the variable's `default`. OAS 3.x requires every `{var}` in a server
 * URL to have a declared variable with a default, so an unresolvable
 * placeholder is a spec bug and is rejected.
 *
 * Substituted values are rejected if they contain characters that would alter
 * URL structure (authority/path separators, whitespace) — these indicate the
 * caller is passing the wrong kind of value (e.g. a path segment into a host
 * slot) and should fail loudly rather than build a malformed URL.
 */
const UNSAFE_VAR_VALUE = /[\s/?#@\\]/

function substituteServerVariables(
  server: OpenApiServer,
  params: Record<string, unknown> | undefined,
): string {
  return server.url.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const fromParam = params?.[name]
    const value = fromParam !== undefined && fromParam !== null
      ? String(fromParam)
      : server.variables?.[name]?.default

    if (value === undefined) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Server URL variable {${name}} has no value: provide it as a param or declare a default in servers[].variables.`,
        action: `Add servers[].variables.${name}.default to the OpenAPI spec, or pass ${name} in the call.`,
        retriable: false,
        failureClass: 'fatal',
      })
    }

    if (UNSAFE_VAR_VALUE.test(value)) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Server URL variable {${name}} value contains URL-unsafe characters: ${JSON.stringify(value)}`,
        action: `Pass a value for ${name} without "/", "?", "#", "@", "\\\\" or whitespace.`,
        retriable: false,
        failureClass: 'fatal',
      })
    }

    return value
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
