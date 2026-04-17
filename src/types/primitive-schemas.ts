// JSON Schema definitions for L2 primitive types.
// Uses `oneOf` + `additionalProperties: false` for discriminated unions.

const injectSchema = {
  type: 'object',
  properties: {
    header: { type: 'string' },
    prefix: { type: 'string' },
    query: { type: 'string' },
    json_body_path: { type: 'string' },
  },
  additionalProperties: false,
} as const

const exchangeCookieStepSchema = {
  type: 'object',
  required: ['extract_from', 'call', 'extract'],
  properties: {
    extract_from: { const: 'cookie' },
    call: { type: 'string' },
    extract: { type: 'string' },
    as: { type: 'string' },
  },
  additionalProperties: false,
} as const

const exchangeHttpStepSchema = {
  type: 'object',
  required: ['call', 'extract'],
  properties: {
    call: { type: 'string' },
    method: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    body: { type: 'object', additionalProperties: { type: 'string' } },
    extract: { type: 'string' },
    extract_from: { const: 'body' },
    as: { type: 'string' },
  },
  additionalProperties: false,
} as const

const exchangeStepSchema = {
  oneOf: [exchangeCookieStepSchema, exchangeHttpStepSchema],
} as const

// ── Auth (6 variants) ──────────────────────────────

export const authPrimitiveSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type'],
      properties: { type: { const: 'cookie_session' } },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'key', 'inject'],
      properties: {
        type: { const: 'localStorage_jwt' },
        key: { type: 'string' },
        path: { type: 'string' },
        app_path: { type: 'string' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'key_pattern', 'token_field', 'inject'],
      properties: {
        type: { const: 'sessionStorage_msal' },
        key_pattern: { type: 'string' },
        scope_filter: { type: 'string' },
        token_field: { type: 'string' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'expression', 'inject'],
      properties: {
        type: { const: 'page_global' },
        expression: { type: 'string' },
        inject: injectSchema,
        values: {
          type: 'array',
          items: {
            type: 'object',
            required: ['expression', 'inject'],
            properties: {
              expression: { type: 'string' },
              inject: injectSchema,
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'chunk_global', 'module_test', 'call', 'inject'],
      properties: {
        type: { const: 'webpack_module_walk' },
        chunk_global: { type: 'string' },
        module_test: { type: 'string' },
        call: { type: 'string' },
        app_path: { type: 'string' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'steps', 'inject'],
      properties: {
        type: { const: 'exchange_chain' },
        steps: { type: 'array', items: exchangeStepSchema, minItems: 1 },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
  ],
} as const

// ── CSRF (3 variants, each with optional scope) ────

const scopeProperty = { scope: { type: 'array', items: { type: 'string' } } } as const

export const csrfWithScopeSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'cookie', 'header'],
      properties: {
        type: { const: 'cookie_to_header' },
        cookie: { type: 'string' },
        header: { type: 'string' },
        ...scopeProperty,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'name', 'header'],
      properties: {
        type: { const: 'meta_tag' },
        name: { type: 'string' },
        header: { type: 'string' },
        ...scopeProperty,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'endpoint', 'extract', 'inject'],
      properties: {
        type: { const: 'api_response' },
        endpoint: { type: 'string' },
        method: { type: 'string' },
        extract: { type: 'string' },
        inject: injectSchema,
        ...scopeProperty,
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Signing (1 variant) ───────────────────────────

export const signingPrimitiveSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'origin', 'inject'],
      properties: {
        type: { const: 'sapisidhash' },
        cookie: { type: 'string' },
        origin: { type: 'string' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Pagination (2 variants) ────────────────────────

export const paginationPrimitiveSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'response_field', 'request_param'],
      properties: {
        type: { const: 'cursor' },
        response_field: { type: 'string' },
        request_param: { type: 'string' },
        has_more_field: { type: 'string' },
        items_path: { type: 'string' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'link_header' },
        rel: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Extraction (4 variants) ────────────────────────

export const extractionPrimitiveSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'path'],
      properties: {
        type: { const: 'ssr_next_data' },
        page_url: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'selectors'],
      properties: {
        type: { const: 'html_selector' },
        page_url: { type: 'string' },
        selectors: { type: 'object', additionalProperties: { type: 'string' }, minProperties: 1 },
        attribute: { type: 'string' },
        multiple: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'selector'],
      properties: {
        type: { const: 'script_json' },
        page_url: { type: 'string' },
        selector: { type: 'string' },
        path: { type: 'string' },
        strip_comments: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'page_global_data' },
        page_url: { type: 'string' },
        expression: { type: 'string' },
        path: { type: 'string' },
        adapter: { type: 'string' },
        method: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const

// ── WS Binding ─────────────────────────────────────

const wsBindingSchema = {
  type: 'object',
  required: ['path', 'source', 'key'],
  properties: {
    path: { type: 'string' },
    source: { enum: ['param', 'auth', 'state'] },
    key: { type: 'string' },
  },
  additionalProperties: false,
} as const

// ── WS Message Template ────────────────────────────

export const wsMessageTemplateSchema = {
  type: 'object',
  required: ['constants', 'bindings'],
  properties: {
    constants: { type: 'object' },
    bindings: { type: 'array', items: wsBindingSchema },
  },
  additionalProperties: false,
} as const

// ── WS Discriminator ───────────────────────────────

const wsDiscriminatorSchema = {
  type: 'object',
  required: ['field'],
  properties: {
    field: { type: 'string' },
    sub_field: { type: 'string' },
    sub_field_on: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
  additionalProperties: false,
} as const

export const wsDiscriminatorConfigSchema = {
  type: 'object',
  required: ['sent', 'received'],
  properties: {
    sent: { oneOf: [wsDiscriminatorSchema, { type: 'null' }] },
    received: { oneOf: [wsDiscriminatorSchema, { type: 'null' }] },
  },
  additionalProperties: false,
} as const

// ── WS Heartbeat ───────────────────────────────────

export const wsHeartbeatSchema = {
  type: 'object',
  required: ['send'],
  properties: {
    send: wsMessageTemplateSchema,
    ack_discriminator: { type: 'object' },
    interval_field: { type: 'string' },
    interval_ms: { type: 'number', minimum: 0 },
    max_missed: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
} as const

// ── WS Auth Config (4 variants) ────────────────────

export const wsAuthConfigSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'discriminator', 'token_path', 'token_source'],
      properties: {
        type: { const: 'ws_first_message' },
        discriminator: { type: 'object' },
        token_path: { type: 'string' },
        token_source: { enum: ['http_auth', 'param'] },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'inject'],
      properties: {
        type: { const: 'ws_upgrade_header' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'param', 'token_source'],
      properties: {
        type: { const: 'ws_url_token' },
        param: { type: 'string' },
        token_source: { enum: ['http_auth', 'param'] },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'endpoint', 'method', 'url_path'],
      properties: {
        type: { const: 'ws_http_handshake' },
        endpoint: { type: 'string' },
        method: { enum: ['GET', 'POST'] },
        url_path: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const

// ── WS Pattern ─────────────────────────────────────

export const wsPatternSchema = {
  enum: ['heartbeat', 'subscribe', 'publish', 'request_reply', 'stream'],
} as const
