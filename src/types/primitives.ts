// ── Inject ──────────────────────────────────────────
export interface Inject {
  readonly header?: string
  readonly prefix?: string
  readonly query?: string
  readonly body_field?: string
  readonly body_merge?: boolean
}

// ── Auth ────────────────────────────────────────────
export interface ExchangeStep {
  readonly call: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, string>>
  readonly extract: string
  readonly as?: string
  readonly expires_field?: string
}

export type AuthPrimitive =
  | { readonly type: 'cookie_session' }
  | { readonly type: 'localStorage_jwt'; readonly key: string; readonly path?: string; readonly inject: Inject }
  | { readonly type: 'sessionStorage_token'; readonly key: string; readonly path?: string; readonly inject: Inject }
  | {
      readonly type: 'sessionStorage_msal'
      readonly key_pattern: string
      readonly scope_filter?: string
      readonly token_field: string
      readonly inject: Inject
    }
  | {
      readonly type: 'page_global'
      readonly expression: string
      readonly inject: Inject
      readonly values?: ReadonlyArray<{ readonly expression: string; readonly inject: Inject }>
    }
  | {
      readonly type: 'webpack_module_walk'
      readonly chunk_global: string
      readonly module_test: string
      readonly call: string
      readonly inject: Inject
    }
  | {
      readonly type: 'websocket_intercept'
      readonly frame_match: { readonly field: string; readonly value: string }
      readonly extract: string
      readonly inject: Inject
      readonly timeout?: number
    }
  | {
      readonly type: 'lazy_fetch'
      readonly endpoint: string
      readonly method?: string
      readonly headers?: Readonly<Record<string, string>>
      readonly extract: string
      readonly inject: Inject
      readonly cache?: boolean
      readonly refresh_on?: readonly number[]
    }
  | {
      readonly type: 'exchange_chain'
      readonly steps: readonly ExchangeStep[]
      readonly refresh_before?: string
      readonly inject: Inject
    }

// ── CSRF ────────────────────────────────────────────
export type CsrfPrimitive =
  | { readonly type: 'cookie_to_header'; readonly cookie: string; readonly header: string }
  | { readonly type: 'meta_tag'; readonly name: string; readonly header: string }
  | { readonly type: 'page_global'; readonly expression: string; readonly inject: Inject }
  | {
      readonly type: 'form_field'
      readonly fetch_url?: string
      readonly selector: string
      readonly attribute?: string
      readonly header?: string
      readonly body_field?: string
    }
  | {
      readonly type: 'api_response'
      readonly endpoint: string
      readonly method?: string
      readonly extract: string
      readonly inject: Inject
      readonly cache?: boolean
    }

// ── Signing ─────────────────────────────────────────
export type SigningPrimitive =
  | { readonly type: 'sapisidhash'; readonly cookie?: string; readonly origin: string; readonly inject: Inject }
  | {
      readonly type: 'gapi_proxy'
      readonly api_key: { readonly source: string; readonly expression: string }
      readonly authuser?: { readonly source: string; readonly expression: string }
    }
  | {
      readonly type: 'aws_sigv4'
      readonly credentials: Readonly<Record<string, string>>
      readonly region: string
      readonly service: string
    }

// ── Pagination ──────────────────────────────────────
export type PaginationPrimitive =
  | {
      readonly type: 'cursor'
      readonly response_field: string
      readonly request_param: string
      readonly has_more_field?: string
    }
  | {
      readonly type: 'offset_limit'
      readonly offset_param?: string
      readonly limit_param?: string
      readonly total_field?: string
      readonly default_limit?: number
    }
  | { readonly type: 'link_header'; readonly rel?: string }
  | {
      readonly type: 'page_number'
      readonly param?: string
      readonly starts_at?: number
      readonly total_pages_field?: string
    }

// ── Extraction ──────────────────────────────────────
export type ExtractionPrimitive =
  | { readonly type: 'ssr_next_data'; readonly page_url?: string; readonly path: string }
  | { readonly type: 'ssr_nuxt'; readonly path: string; readonly payload_url?: string }
  | {
      readonly type: 'apollo_cache'
      readonly source?: string
      readonly key_pattern: string
      readonly fields?: readonly string[]
    }
  | {
      readonly type: 'html_selector'
      readonly page_url?: string
      readonly selectors: Readonly<Record<string, string>>
      readonly attribute?: string
      readonly multiple?: boolean
    }
  | { readonly type: 'script_json'; readonly selector: string; readonly path?: string }
  | { readonly type: 'page_global_data'; readonly expression: string; readonly path?: string }
