// Barrel — public type exports
export type {
  ManifestFingerprint,
  ManifestStats,
  Manifest,
} from './manifest.js'

export type {
  Inject,
  ExchangeCookieStep,
  ExchangeHttpStep,
  ExchangeStep,
  AuthPrimitive,
  CsrfPrimitive,
  SigningPrimitive,
  PaginationPrimitive,
  ExtractionPrimitive,
} from './primitives.js'

export type {
  PermissionCategory,
  Transport,
  AdapterRef,
  XOpenWebServer,
  XOpenWebBuildMeta,
  XOpenWebOperation,
} from './extensions.js'

export type { XOpenWebWsServer, XOpenWebWsOperation } from './ws-extensions.js'

export type {
  WsDiscriminator,
  WsDiscriminatorConfig,
  WsFirstMessage,
  WsUpgradeHeader,
  WsUrlToken,
  WsHttpHandshake,
  WsAuthConfig,
  WsBinding,
  WsMessageTemplate,
  WsHeartbeat,
  WsPattern,
} from './ws-primitives.js'

export type { CodeAdapter } from './adapter.js'

export {
  authPrimitiveSchema,
  csrfWithScopeSchema,
  signingPrimitiveSchema,
  paginationPrimitiveSchema,
  extractionPrimitiveSchema,
  wsMessageTemplateSchema,
  wsDiscriminatorConfigSchema,
  wsHeartbeatSchema,
  wsAuthConfigSchema,
  wsPatternSchema,
} from './primitive-schemas.js'

export {
  adapterRefSchema,
  transportSchema,
  permissionSchema,
  buildMetaSchema,
  wsReconnectSchema,
  wsCorrelationSchema,
  xOpenWebServerSchema,
  xOpenWebOperationSchema,
  manifestSchema,
  xOpenWebWsServerSchema,
  xOpenWebWsOperationSchema,
  asyncApiSpecSchema,
} from './schema.js'

export type { ValidationResult, ValidationError } from './validator.js'
export { validateXOpenWebSpec, validateManifest, validateAsyncApiSpec } from './validator.js'
