import { OpenWebError } from './errors.js'
import { validateType } from './param-validator.js'
import type { JsonSchema, OpenApiParameter } from './spec-loader.js'

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
