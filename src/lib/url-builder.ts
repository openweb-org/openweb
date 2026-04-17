import { OpenWebError } from './errors.js'
import { validateType } from './param-validator.js'
import type { JsonSchema, OpenApiParameter } from './spec-loader.js'
import type { XOpenWebParameter } from '../types/extensions.js'

const TEMPLATE_PLACEHOLDER = /\{([^{}]+)\}/g

function paramExt(param: OpenApiParameter): XOpenWebParameter | undefined {
  return (param as unknown as Record<string, unknown>)['x-openweb'] as XOpenWebParameter | undefined
}

export function buildQueryUrl(
  baseServerUrl: string,
  apiPath: string,
  parameters: OpenApiParameter[] | undefined,
  inputParams: Record<string, unknown>,
  extraQueryParams?: Readonly<Record<string, string>>,
): string {
  const baseUrl = new URL(baseServerUrl)
  const fullPath = baseUrl.origin + baseUrl.pathname.replace(/\/$/, '') + apiPath
  const target = new URL(fullPath)

  const allParameters = parameters ?? []
  const queryParameters = allParameters.filter((param) => param.in === 'query')
  const declaredNames = new Set(queryParameters.map((p) => p.name))

  // Template-source params: names referenced as {name} by any sibling's x-openweb.template,
  // AND not themselves appearing in the apiPath. These are derivation inputs, not wire params —
  // skip emitting them to the URL even though they're declared in the spec.
  const templateSources = new Set<string>()
  for (const param of allParameters) {
    const template = paramExt(param)?.template
    if (template === undefined) continue
    for (const match of template.matchAll(TEMPLATE_PLACEHOLDER)) {
      const ref = match[1]
      if (!apiPath.includes(`{${ref}}`)) templateSources.add(ref)
    }
  }

  for (const parameter of queryParameters) {
    if (templateSources.has(parameter.name)) continue
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

  if (extraQueryParams) {
    for (const [key, value] of Object.entries(extraQueryParams)) {
      if (!declaredNames.has(key)) target.searchParams.set(key, value)
    }
  }

  return target.toString()
}
