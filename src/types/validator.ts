import Ajv from 'ajv'

import { manifestSchema, xOpenWebOperationSchema, xOpenWebServerSchema } from './schema.js'

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly ValidationError[]
}

export interface ValidationError {
  readonly path: string
  readonly message: string
}

const ajv = new Ajv({ allErrors: true, strict: false })

const validateServerExt = ajv.compile(xOpenWebServerSchema)
const validateOperationExt = ajv.compile(xOpenWebOperationSchema)
const validateManifestJson = ajv.compile(manifestSchema)

function formatErrors(errors: typeof validateServerExt.errors, basePath: string): ValidationError[] {
  if (!errors) return []
  return errors.map((e) => ({
    path: `${basePath}${e.instancePath}`,
    message: e.message ?? 'unknown error',
  }))
}

interface OpenApiLike {
  readonly servers?: ReadonlyArray<{
    readonly url?: string
    readonly 'x-openweb'?: unknown
  }>
  readonly paths?: Readonly<
    Record<
      string,
      Readonly<
        Partial<
          Record<
            string,
            {
              readonly operationId?: string
              readonly 'x-openweb'?: unknown
            }
          >
        >
      >
    >
  >
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const

/**
 * Validate all x-openweb extensions in an OpenAPI spec.
 * Specs without x-openweb extensions are valid (L1-only).
 */
export function validateXOpenWebSpec(spec: OpenApiLike): ValidationResult {
  const errors: ValidationError[] = []

  // Validate server-level x-openweb
  const servers = spec.servers ?? []
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i]
    const ext = server?.['x-openweb']
    if (!ext) continue

    if (!validateServerExt(ext)) {
      errors.push(...formatErrors(validateServerExt.errors, `servers[${i}].x-openweb`))
    }
  }

  // Validate operation-level x-openweb
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods?.[method]
      if (!op) continue

      const ext = op['x-openweb']
      if (!ext) continue

      if (!validateOperationExt(ext)) {
        errors.push(
          ...formatErrors(validateOperationExt.errors, `paths["${path}"].${method}.x-openweb`),
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate a manifest.json object.
 */
export function validateManifest(manifest: unknown): ValidationResult {
  if (!validateManifestJson(manifest)) {
    return {
      valid: false,
      errors: formatErrors(validateManifestJson.errors, 'manifest'),
    }
  }
  return { valid: true, errors: [] }
}
