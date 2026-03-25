import Ajv from 'ajv'

import {
  asyncApiSpecSchema,
  manifestSchema,
  xOpenWebOperationSchema,
  xOpenWebServerSchema,
  xOpenWebWsOperationSchema,
  xOpenWebWsServerSchema,
} from './schema.js'

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
const validateAsyncApiStructure = ajv.compile(asyncApiSpecSchema)
const validateWsServerExt = ajv.compile(xOpenWebWsServerSchema)
const validateWsOperationExt = ajv.compile(xOpenWebWsOperationSchema)

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
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return { valid: false, errors: [{ path: '', message: 'spec must be a non-null object' }] }
  }

  const errors: ValidationError[] = []

  // Validate server-level x-openweb
  const servers = Array.isArray(spec.servers) ? spec.servers : []
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i]
    if (typeof server !== 'object' || server === null) continue

    const ext = server['x-openweb']
    if (ext == null) continue

    if (!validateServerExt(ext)) {
      errors.push(...formatErrors(validateServerExt.errors, `servers[${i}].x-openweb`))
    }
  }

  // Validate operation-level x-openweb
  const paths = typeof spec.paths === 'object' && spec.paths !== null ? spec.paths : {}
  for (const [path, methods] of Object.entries(paths)) {
    if (typeof methods !== 'object' || methods === null) continue

    for (const method of HTTP_METHODS) {
      const op = methods?.[method]
      if (typeof op !== 'object' || op === null) continue

      const ext = op['x-openweb']
      if (ext == null) continue

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

interface AsyncApiLike {
  readonly asyncapi?: string
  readonly info?: { readonly title?: string; readonly version?: string }
  readonly servers?: Readonly<Record<string, { readonly 'x-openweb'?: unknown }>>
  readonly operations?: Readonly<Record<string, { readonly 'x-openweb'?: unknown }>>
}

/**
 * Validate an AsyncAPI 3.0 spec with x-openweb WS extensions.
 * Checks structural validity (version, required fields) and validates
 * all x-openweb extensions on servers and operations.
 */
export function validateAsyncApiSpec(spec: AsyncApiLike): ValidationResult {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return { valid: false, errors: [{ path: '', message: 'spec must be a non-null object' }] }
  }

  const errors: ValidationError[] = []

  // Structural validation (asyncapi version, info)
  if (!validateAsyncApiStructure(spec)) {
    errors.push(...formatErrors(validateAsyncApiStructure.errors, ''))
    return { valid: false, errors }
  }

  // Validate server-level x-openweb
  const servers = typeof spec.servers === 'object' && spec.servers !== null ? spec.servers : {}
  for (const [name, server] of Object.entries(servers)) {
    if (typeof server !== 'object' || server === null) continue

    const ext = server['x-openweb']
    if (ext == null) continue

    if (!validateWsServerExt(ext)) {
      errors.push(...formatErrors(validateWsServerExt.errors, `servers.${name}.x-openweb`))
    }
  }

  // Validate operation-level x-openweb
  const operations =
    typeof spec.operations === 'object' && spec.operations !== null ? spec.operations : {}
  for (const [opId, op] of Object.entries(operations)) {
    if (typeof op !== 'object' || op === null) continue

    const ext = op['x-openweb']
    if (ext == null) continue

    if (!validateWsOperationExt(ext)) {
      errors.push(...formatErrors(validateWsOperationExt.errors, `operations.${opId}.x-openweb`))
    }
  }

  return { valid: errors.length === 0, errors }
}
