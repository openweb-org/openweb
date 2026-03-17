import os from 'node:os'
import path from 'node:path'
import { access, readdir, readFile } from 'node:fs/promises'

import { parse } from 'yaml'

import { OpenWebError } from './errors.js'
import { validateXOpenWebSpec } from '../types/validator.js'

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

export interface OpenApiOperation {
  readonly operationId: string
  readonly summary?: string
  readonly description?: string
  readonly servers?: Array<{ readonly url: string }>
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
  readonly servers?: Array<{ readonly url: string }>
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function candidateSiteRoots(site: string): string[] {
  return [
    path.join(os.homedir(), '.openweb', 'sites', site),
    path.join(process.cwd(), 'sites', site),
    path.join(process.cwd(), 'src', 'fixtures', site),
  ]
}

export async function resolveSiteRoot(site: string): Promise<string> {
  // Check registry current version first (inlined to avoid circular dep with lifecycle/registry)
  const registryCurrentFile = path.join(os.homedir(), '.openweb', 'registry', site, 'current')
  try {
    const currentVersion = (await readFile(registryCurrentFile, 'utf8')).trim()
    const registryVersionPath = path.join(os.homedir(), '.openweb', 'registry', site, currentVersion)
    if (await pathExists(path.join(registryVersionPath, 'openapi.yaml'))) {
      return registryVersionPath
    }
  } catch { /* no registry entry — fall through */ }

  const roots = candidateSiteRoots(site)

  for (const root of roots) {
    if (await pathExists(path.join(root, 'openapi.yaml'))) {
      return root
    }
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'TOOL_NOT_FOUND',
    message: `Site not found: ${site}`,
    action: 'Run `openweb sites` to list available sites.',
    retriable: false,
    failureClass: 'fatal',
  })
}

export async function listSites(): Promise<string[]> {
  const roots = [
    path.join(os.homedir(), '.openweb', 'registry'),
    path.join(os.homedir(), '.openweb', 'sites'),
    path.join(process.cwd(), 'sites'),
    path.join(process.cwd(), 'src', 'fixtures'),
  ]

  const names = new Set<string>()

  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }
        // Registry entries have version subdirs — check for `current` file
        if (root.endsWith('registry')) {
          const currentFile = path.join(root, entry.name, 'current')
          if (await pathExists(currentFile)) {
            names.add(entry.name)
          }
          continue
        }
        const candidate = path.join(root, entry.name, 'openapi.yaml')
        if (await pathExists(candidate)) {
          names.add(entry.name)
        }
      }
    } catch {
      // Directory may not exist; ignore.
    }
  }

  return Array.from(names).sort()
}

export async function loadOpenApi(site: string): Promise<OpenApiSpec> {
  const root = await resolveSiteRoot(site)
  const content = await readFile(path.join(root, 'openapi.yaml'), 'utf8')
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
  return operation
}

export function getServerUrl(spec: OpenApiSpec, operation: OpenApiOperation): string {
  const operationServer = operation.servers?.[0]?.url
  if (operationServer) {
    return operationServer
  }

  const globalServer = spec.servers?.[0]?.url
  if (globalServer) {
    return globalServer
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
 * Validate and apply defaults to user-supplied params against OpenAPI parameter definitions.
 * Checks: required params present, no unknown params, schema type validation, default application.
 * Returns a new params object with defaults applied.
 */
export function validateParams(
  parameters: OpenApiParameter[],
  inputParams: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...inputParams }
  const knownNames = new Set(parameters.map((p) => p.name))
  const unknownNames = Object.keys(inputParams).filter((n) => !knownNames.has(n))

  if (unknownNames.length > 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: `Unknown parameter(s): ${unknownNames.join(', ')}`,
      action: 'Run `openweb <site> <tool>` to inspect valid parameters.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  for (const param of parameters) {
    // Enforce const: field is immutable, caller cannot override
    if (param.schema?.const !== undefined) {
      const callerValue = result[param.name]
      if (callerValue !== undefined && callerValue !== null && callerValue !== param.schema.const) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: `Parameter ${param.name} is fixed and cannot be overridden`,
          action: 'This parameter is a const field defined by the fixture. Remove it from your input.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      result[param.name] = param.schema.const
      continue
    }

    const value = result[param.name]
    if ((value === undefined || value === null) && param.schema?.default !== undefined) {
      result[param.name] = structuredClone(param.schema.default)
    }
    if ((result[param.name] === undefined || result[param.name] === null) && param.required) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'INVALID_PARAMS',
        message: `Missing required parameter: ${param.name}`,
        action: 'Run `openweb <site> <tool>` to inspect parameters.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    if (result[param.name] !== undefined && result[param.name] !== null) {
      validateType(param.name, result[param.name], param.schema)
    }
  }

  return result
}

function validateType(name: string, value: unknown, schema: JsonSchema | undefined): void {
  const types = getSchemaTypes(schema)
  if (types.length === 0) {
    return
  }

  if (types.includes('null') && value === null) {
    return
  }

  if (types.includes('integer') && typeof value === 'number' && Number.isInteger(value)) {
    return
  }

  if (types.includes('number') && typeof value === 'number' && !Number.isNaN(value)) {
    return
  }

  if (types.includes('string') && typeof value === 'string') {
    return
  }

  if (types.includes('boolean') && typeof value === 'boolean') {
    return
  }

  if (types.includes('array')) {
    if (Array.isArray(value)) {
      if (!schema?.items) {
        return
      }
      for (const item of value) {
        validateType(name, item, schema.items)
      }
      return
    }
  }

  if (types.includes('object')) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return
    }
  }

  throw invalidTypeError(name, types)
}

function invalidTypeError(name: string, types: string[]): OpenWebError {
  return new OpenWebError({
    error: 'execution_failed',
    code: 'INVALID_PARAMS',
    message: `Parameter ${name} must be ${types.join(' | ')}`,
    action: 'Run `openweb <site> <tool>` to inspect parameters.',
    retriable: false,
    failureClass: 'fatal',
  })
}

function getSchemaTypes(schema: JsonSchema | undefined): string[] {
  if (!schema?.type) {
    return []
  }
  return Array.isArray(schema.type) ? schema.type : [schema.type]
}

export function buildQueryUrl(
  baseServerUrl: string,
  apiPath: string,
  parameters: OpenApiParameter[] | undefined,
  inputParams: Record<string, unknown>,
): string {
  const target = new URL(apiPath, baseServerUrl)

  const allParameters = parameters ?? []
  const queryParameters = allParameters.filter((param) => param.in === 'query')

  for (const parameter of queryParameters) {
    const value = inputParams[parameter.name] ?? (
      parameter.schema?.default !== undefined ? structuredClone(parameter.schema.default) : undefined
    )
    if ((value === undefined || value === null) && parameter.required) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'INVALID_PARAMS',
        message: `Missing required parameter: ${parameter.name}`,
        action: 'Run `openweb <site> <tool>` to inspect parameters.',
        retriable: false,
        failureClass: 'fatal',
      })
    }

    if (value === undefined || value === null) {
      continue
    }

    validateType(parameter.name, value, parameter.schema)

    if (Array.isArray(value)) {
      for (const item of value) {
        target.searchParams.append(parameter.name, String(item))
      }
      continue
    }

    target.searchParams.set(parameter.name, String(value))
  }

  return target.toString()
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
}

export function isObjectSchema(schema: JsonSchema | undefined): boolean {
  return getSchemaTypes(schema).includes('object')
}

export function isArraySchema(schema: JsonSchema | undefined): boolean {
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
