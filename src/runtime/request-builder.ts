import { OpenWebError } from '../lib/errors.js'
import {
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiSpec,
  getRequestBodyParameters,
  getRequestBodySchema,
  isObjectSchema,
} from '../lib/spec-loader.js'
import type { XOpenWebOperation } from '../types/extensions.js'

const UNSAFE_REF_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** Substitute path parameters like {user_id} in the URL path */
export function substitutePath(
  pathTemplate: string,
  parameters: OpenApiParameter[] | undefined,
  params: Record<string, unknown>,
): string {
  let result = pathTemplate
  const pathParams = (parameters ?? []).filter((p) => p.in === 'path')

  for (const param of pathParams) {
    const value = params[param.name]
    if (value === undefined || value === null) {
      if (param.required !== false) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: `Missing required path parameter: ${param.name}`,
          action: 'Run `openweb <site> <tool>` to inspect parameters.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      continue
    }
    result = result.replace(`{${param.name}}`, encodeURIComponent(String(value)))
  }

  const unreplaced = result.match(/\{[^}]+\}/g)
  if (unreplaced) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: `Unresolved path variables: ${unreplaced.join(', ')}`,
      action: 'Provide values for all path parameters.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return result
}

/** Build headers from parameters with in=header (applying defaults) */
export function buildHeaderParams(
  parameters: OpenApiParameter[] | undefined,
  params: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerParams = (parameters ?? []).filter((p) => p.in === 'header')

  for (const param of headerParams) {
    const value = params[param.name] ?? param.schema?.default
    if (value === undefined || value === null) {
      if (param.required) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: `Missing required header parameter: ${param.name}`,
          action: 'Run `openweb <site> <tool>` to inspect parameters.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      continue
    }
    headers[param.name] = String(value)
  }

  return headers
}

/** Recursively build an object from schema, applying defaults for missing values */
function applySchemaDefaults(schema: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!schema || schema.type !== 'object' || !schema.properties) return undefined
  const props = schema.properties as Record<string, Record<string, unknown>>
  const result: Record<string, unknown> = {}
  let hasValue = false
  for (const [key, propSchema] of Object.entries(props)) {
    if (propSchema.const !== undefined) {
      result[key] = structuredClone(propSchema.const)
      hasValue = true
    } else if (propSchema.default !== undefined) {
      result[key] = propSchema.default
      hasValue = true
    } else if (propSchema.type === 'object') {
      const nested = applySchemaDefaults(propSchema)
      if (nested) {
        result[key] = nested
        hasValue = true
      }
    }
  }
  return hasValue ? result : undefined
}

/** Build JSON request body from operation schema and params */
export function buildJsonRequestBody(operation: OpenApiOperation, params: Record<string, unknown>): string | undefined {
  const bodySchema = getRequestBodySchema(operation)
  if (!isObjectSchema(bodySchema)) {
    return undefined
  }

  const opExt = (operation as { 'x-openweb'?: unknown })['x-openweb'] as XOpenWebOperation | undefined
  const wrapKey = opExt?.wrap

  const bodyParams = getRequestBodyParameters(operation)
  const body: Record<string, unknown> = {}
  const wrapped: Record<string, unknown> = {}
  for (const param of bodyParams) {
    const isConst = param.schema?.const !== undefined
    const target = wrapKey && !isConst ? wrapped : body
    const value = params[param.name]
    if (value !== undefined) {
      if (param.schema?.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const defaults = applySchemaDefaults(param.schema as Record<string, unknown>)
        target[param.name] = defaults ? { ...defaults, ...(value as Record<string, unknown>) } : value
      } else {
        target[param.name] = value
      }
    } else if (param.schema?.type === 'object') {
      target[param.name] = applySchemaDefaults(param.schema as Record<string, unknown>) ?? {}
    }
  }

  if (wrapKey && Object.keys(wrapped).length > 0) {
    body[wrapKey] = wrapped
  }

  // Inject GraphQL query string at body root when wrap is active
  // and the schema property name conflicts with a user-facing param
  if (wrapKey && opExt?.graphql_query) {
    body.query = opExt.graphql_query
  }

  if (Object.keys(body).length === 0 && !operation.requestBody?.required) {
    return undefined
  }

  return JSON.stringify(body)
}

/** Collect parameters from operation + $ref components resolution */
export function resolveAllParameters(spec: OpenApiSpec, operation: OpenApiOperation): OpenApiParameter[] {
  const params = operation.parameters ?? []
  return params.flatMap((p) => {
    const ref = (p as unknown as Record<string, unknown>).$ref as string | undefined
    if (!ref) return [p]

    const parts = ref.replace('#/', '').split('/')
    if (parts.some((part) => UNSAFE_REF_SEGMENTS.has(part))) return []
    let resolved: unknown = spec
    for (const part of parts) {
      resolved = (resolved as Record<string, unknown>)?.[part]
    }

    if (!resolved || typeof resolved !== 'object') {
      process.stderr.write(`\u26A0 Unresolved $ref: ${ref} in operation parameters\n`)
      return []
    }
    return [resolved as OpenApiParameter]
  })
}

/**
 * Minimal query-param encoder: encodes characters that break URL structure
 * (&, =, #, space, +) and JSON structural characters ({, }, ") while
 * preserving sub-delimiters ( ) : , that APIs like LinkedIn's Rest.li expect
 * unencoded. Any existing percent-encoding in the value is preserved.
 */
function encodeQueryValue(value: string): string {
  // Temporarily protect existing %XX sequences
  const protected_ = value.replace(/%([0-9A-Fa-f]{2})/g, '\0$1')
  const encoded = protected_
    .replace(/%/g, '%25')   // encode bare % signs
    .replace(/ /g, '%20')
    .replace(/\t/g, '%09')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .replace(/#/g, '%23')
    .replace(/\+/g, '%2B')
    .replace(/\{/g, '%7B')
    .replace(/\}/g, '%7D')
    .replace(/"/g, '%22')
  // Restore protected %XX sequences
  return encoded.replace(/\0([0-9A-Fa-f]{2})/g, '%$1')
}

/** Build a URL from server base, resolved path, and query parameters.
 *  Returns a raw URL string with minimal query encoding — preserves
 *  sub-delimiters ( ) : , and any pre-existing percent-encoding in values. */
export function buildTargetUrl(
  serverUrl: string,
  resolvedPath: string,
  allParams: OpenApiParameter[],
  inputParams: Record<string, unknown>,
  extraQueryParams?: Readonly<Record<string, string>>,
): string {
  const baseUrl = new URL(serverUrl)
  const basePath = baseUrl.origin + baseUrl.pathname.replace(/\/$/, '') + resolvedPath
  const pairs: string[] = []
  const seen = new Set<string>()
  for (const param of allParams.filter((p) => p.in === 'query')) {
    const value = inputParams[param.name]
    if (value === undefined || value === null) continue
    seen.add(param.name)
    if (Array.isArray(value)) {
      for (const item of value) pairs.push(`${encodeQueryValue(param.name)}=${encodeQueryValue(String(item))}`)
    } else {
      pairs.push(`${encodeQueryValue(param.name)}=${encodeQueryValue(String(value))}`)
    }
  }
  if (extraQueryParams) {
    for (const [key, value] of Object.entries(extraQueryParams)) {
      if (!seen.has(key)) {
        pairs.push(`${encodeQueryValue(key)}=${encodeQueryValue(value)}`)
      }
    }
  }
  return pairs.length > 0 ? `${basePath}?${pairs.join('&')}` : basePath
}
