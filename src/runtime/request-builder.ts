import { OpenWebError } from '../lib/errors.js'
import {
  getRequestBodyParameters,
  getRequestBodySchema,
  isObjectSchema,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiSpec,
} from '../lib/openapi.js'

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

/** Build JSON request body from operation schema and params */
export function buildJsonRequestBody(operation: OpenApiOperation, params: Record<string, unknown>): string | undefined {
  const bodySchema = getRequestBodySchema(operation)
  if (!isObjectSchema(bodySchema)) {
    return undefined
  }

  const bodyParams = getRequestBodyParameters(operation)
  const body: Record<string, unknown> = {}
  for (const param of bodyParams) {
    const value = params[param.name]
    if (value !== undefined) {
      body[param.name] = value
    } else if (param.schema?.type === 'object') {
      body[param.name] = {}
    }
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
    const ref = (p as unknown as Record<string, unknown>)['$ref'] as string | undefined
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
