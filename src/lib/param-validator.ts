import { OpenWebError } from './errors.js'
import type { JsonSchema, OpenApiParameter } from './spec-loader.js'
import { getSchemaTypes } from './spec-loader.js'

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
          action: 'This parameter is a const field defined by the site. Remove it from your input.',
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

export function validateType(name: string, value: unknown, schema: JsonSchema | undefined): void {
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
