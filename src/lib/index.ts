// Barrel — public lib exports
export {
  OpenWebError,
  writeErrorToStderr,
  toOpenWebError,
  getHttpFailure,
} from './errors.js'
export type { OpenWebErrorCode, FailureClass, OpenWebErrorPayload } from './errors.js'

export { logger } from './logger.js'

export { validateSSRF, ssrfInternals } from './ssrf.js'

export {
  loadOpenApi,
  listOperations,
  findOperation,
  getServerUrl,
  getResponseSchema,
  getRequestBodySchema,
  getSchemaTypes,
  isObjectSchema,
  isArraySchema,
  getRequestBodyParameters,
} from './spec-loader.js'
export type {
  JsonSchema,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiOperation,
  OpenApiSpec,
  OperationRef,
  HttpMethod,
} from './spec-loader.js'

export { pathExists, resolveSiteRoot, listSites } from './site-resolver.js'
export type { ResolveSiteOptions } from './site-resolver.js'

export { validateParams } from './param-validator.js'
export { buildQueryUrl } from './url-builder.js'
export { loadManifest, saveManifest } from './manifest.js'

export { shouldApplyCsrf } from './csrf-scope.js'
export { parseResponseBody } from './response-parser.js'
export { derivePermissionFromMethod } from './permission-derive.js'

export type { Policy, PermissionsConfig } from './permissions.js'
export { loadPermissions, checkPermission } from './permissions.js'

export {
  parseAsyncApiSpec,
  loadAsyncApi,
  listAsyncApiOperations,
} from './asyncapi.js'
export type {
  AsyncApiServer,
  AsyncApiMessage,
  AsyncApiChannel,
  AsyncApiOperation,
  AsyncApiSpec,
  AsyncApiOperationRef,
} from './asyncapi.js'

export { loadSitePackage, findOperationEntry } from './site-package.js'
export type {
  HttpOperationEntry,
  WsOperationEntry,
  OperationEntry,
  SitePackage,
} from './site-package.js'
