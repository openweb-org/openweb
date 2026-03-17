// JSON Schema definitions for L2 primitive types.
// Uses `oneOf` + `additionalProperties: false` for discriminated unions.

const injectSchema = {
  type: 'object',
  properties: {
    header: { type: 'string' },
    prefix: { type: 'string' },
    query: { type: 'string' },
    body_field: { type: 'string' },
    body_merge: { type: 'boolean' },
  },
  additionalProperties: false,
} as const

const exchangeStepSchema = {
  type: 'object',
  required: ['call', 'extract'],
  properties: {
    call: { type: 'string' },
    method: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    body: { type: 'object', additionalProperties: { type: 'string' } },
    extract: { type: 'string' },
    extract_from: { type: 'string', enum: ['body', 'cookie'] },
    as: { type: 'string' },
  },
  additionalProperties: false,
} as const

// ── Auth (9 variants) ──────────────────────────────

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
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'key', 'inject'],
      properties: {
        type: { const: 'sessionStorage_token' },
        key: { type: 'string' },
        path: { type: 'string' },
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
        inject: injectSchema,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'frame_match', 'extract', 'inject'],
      properties: {
        type: { const: 'websocket_intercept' },
        frame_match: {
          type: 'object',
          required: ['field', 'value'],
          properties: {
            field: { type: 'string' },
            value: { type: 'string' },
          },
          additionalProperties: false,
        },
        extract: { type: 'string' },
        inject: injectSchema,
        timeout: { type: 'number' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'endpoint', 'extract', 'inject'],
      properties: {
        type: { const: 'lazy_fetch' },
        endpoint: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        extract: { type: 'string' },
        inject: injectSchema,
        cache: { type: 'boolean' },
        refresh_on: { type: 'array', items: { type: 'number' } },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'steps', 'inject'],
      properties: {
        type: { const: 'exchange_chain' },
        steps: { type: 'array', items: exchangeStepSchema, minItems: 1 },
        refresh_before: { type: 'string' },
        inject: injectSchema,
      },
      additionalProperties: false,
    },
  ],
} as const

// ── CSRF (5 variants, each with optional scope) ────

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
      required: ['type', 'expression', 'inject'],
      properties: {
        type: { const: 'page_global' },
        expression: { type: 'string' },
        inject: injectSchema,
        ...scopeProperty,
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'selector'],
      properties: {
        type: { const: 'form_field' },
        fetch_url: { type: 'string' },
        selector: { type: 'string' },
        attribute: { type: 'string' },
        header: { type: 'string' },
        body_field: { type: 'string' },
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
        cache: { type: 'boolean' },
        ...scopeProperty,
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Signing (3 variants) ───────────────────────────

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
    {
      type: 'object',
      required: ['type', 'api_key'],
      properties: {
        type: { const: 'gapi_proxy' },
        api_key: {
          type: 'object',
          required: ['source', 'expression'],
          properties: {
            source: { type: 'string' },
            expression: { type: 'string' },
          },
          additionalProperties: false,
        },
        authuser: {
          type: 'object',
          required: ['source', 'expression'],
          properties: {
            source: { type: 'string' },
            expression: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'credentials', 'region', 'service'],
      properties: {
        type: { const: 'aws_sigv4' },
        credentials: { type: 'object', additionalProperties: { type: 'string' } },
        region: { type: 'string' },
        service: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Pagination (4 variants) ────────────────────────

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
        type: { const: 'offset_limit' },
        offset_param: { type: 'string' },
        limit_param: { type: 'string' },
        total_field: { type: 'string' },
        default_limit: { type: 'number' },
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
    {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'page_number' },
        param: { type: 'string' },
        starts_at: { type: 'number' },
        total_pages_field: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const

// ── Extraction (6 variants) ────────────────────────

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
      required: ['type', 'path'],
      properties: {
        type: { const: 'ssr_nuxt' },
        path: { type: 'string' },
        payload_url: { type: 'string' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'key_pattern'],
      properties: {
        type: { const: 'apollo_cache' },
        source: { type: 'string' },
        key_pattern: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
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
        selector: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['type', 'expression'],
      properties: {
        type: { const: 'page_global_data' },
        page_url: { type: 'string' },
        expression: { type: 'string' },
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
  ],
} as const
