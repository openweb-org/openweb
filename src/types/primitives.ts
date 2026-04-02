// ── Inject ──────────────────────────────────────────
export interface Inject {
  readonly header?: string
  readonly prefix?: string
  readonly query?: string
  readonly json_body_path?: string
}

// ── Auth ────────────────────────────────────────────
export interface ExchangeCookieStep {
  readonly extract_from: 'cookie'
  readonly call: string
  readonly extract: string
  readonly as?: string
}

export interface ExchangeHttpStep {
  readonly call: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, string>>
  readonly extract: string
  readonly extract_from?: 'body'
  readonly as?: string
}

export type ExchangeStep = ExchangeCookieStep | ExchangeHttpStep

export type AuthPrimitive =
  | { readonly type: 'cookie_session' }
  | { readonly type: 'localStorage_jwt'; readonly key: string; readonly path?: string; readonly inject: Inject }
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
      readonly app_path?: string
      readonly inject: Inject
    }
  | {
      readonly type: 'exchange_chain'
      readonly steps: readonly ExchangeStep[]
      readonly inject: Inject
    }

// ── CSRF ────────────────────────────────────────────
export type CsrfPrimitive =
  | { readonly type: 'cookie_to_header'; readonly cookie: string; readonly header: string }
  | { readonly type: 'meta_tag'; readonly name: string; readonly header: string }
  | {
      readonly type: 'api_response'
      readonly endpoint: string
      readonly method?: string
      readonly extract: string
      readonly inject: Inject
    }

// ── Signing ─────────────────────────────────────────
export type SigningPrimitive =
  | { readonly type: 'sapisidhash'; readonly cookie?: string; readonly origin: string; readonly inject: Inject }

// ── Pagination ──────────────────────────────────────
export type PaginationPrimitive =
  | {
      readonly type: 'cursor'
      readonly response_field: string
      readonly request_param: string
      readonly has_more_field?: string
      readonly items_path?: string
    }
  | { readonly type: 'link_header'; readonly rel?: string }

// ── Extraction ──────────────────────────────────────
export type ExtractionPrimitive =
  | { readonly type: 'ssr_next_data'; readonly page_url?: string; readonly path: string }
  | {
      readonly type: 'html_selector'
      readonly page_url?: string
      readonly selectors: Readonly<Record<string, string>>
      readonly attribute?: string
      readonly multiple?: boolean
    }
  | { readonly type: 'script_json'; readonly selector: string; readonly path?: string }
  | { readonly type: 'page_global_data'; readonly page_url?: string; readonly expression: string; readonly path?: string }
