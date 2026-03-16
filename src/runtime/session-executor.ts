import type { Browser, BrowserContext, Page } from 'playwright'

import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import {
  getRequestBodyParameters,
  validateParams,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiSpec,
} from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../types/primitives.js'
import type { ExecutionMode, XOpenWebServer } from '../types/extensions.js'
import { resolveApiResponse } from './primitives/api-response.js'
import { resolveCookieSession } from './primitives/cookie-session.js'
import { resolveCookieToHeader } from './primitives/cookie-to-header.js'
import { resolveExchangeChain } from './primitives/exchange-chain.js'
import { resolveLocalStorageJwt } from './primitives/localstorage-jwt.js'
import { resolveMetaTag } from './primitives/meta-tag.js'
import { resolvePageGlobal } from './primitives/page-global.js'
import { resolveSapisidhash } from './primitives/sapisidhash.js'
import { resolveWebpackModuleWalk } from './primitives/webpack-module-walk.js'
import type { BrowserHandle, ResolvedInjections } from './primitives/types.js'

/** Auth resolution result — extends ResolvedInjections with optional query params */
interface AuthResult extends ResolvedInjections {
  readonly queryParams?: Readonly<Record<string, string>>
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const VALID_MODES = new Set<string>(['direct_http', 'session_http', 'browser_fetch'])
const MAX_REDIRECTS = 5
const SENSITIVE_HEADERS = ['cookie', 'authorization', 'x-csrftoken', 'x-csrf-token']
const UNSAFE_REF_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function getPageHintUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl)
    const pageUrl = new URL(url.toString())
    if (pageUrl.hostname.startsWith('api.')) {
      pageUrl.hostname = pageUrl.hostname.slice(4)
      pageUrl.pathname = '/'
      pageUrl.search = ''
      pageUrl.hash = ''
      return pageUrl.toString()
    }

    return `${url.origin}/`
  } catch {
    return serverUrl
  }
}

async function listCandidatePages(context: BrowserContext): Promise<Page[]> {
  const candidates: Page[] = []
  for (const page of context.pages()) {
    try {
      const currentUrl = page.url()
      if (!currentUrl) {
        continue
      }

      const pathname = new URL(currentUrl).pathname
      if (pathname.endsWith('.js')) {
        continue
      }

      const content = (await page.content()).trim()
      if (!content) {
        continue
      }

      candidates.push(page)
    } catch {
      // Ignore detached pages and invalid URLs.
    }
  }

  return candidates
}

/** Find a page whose URL matches the target server origin (for page.evaluate scoping) */
export async function findPageForOrigin(context: BrowserContext, serverUrl: string): Promise<Page | undefined> {
  try {
    const targetOrigin = new URL(serverUrl).origin
    const targetHost = new URL(serverUrl).hostname
    const pages = await listCandidatePages(context)

    // Pass 1: exact origin match
    for (const page of pages) {
      try {
        if (page.url().startsWith(targetOrigin)) return page
      } catch { /* skip */ }
    }

    // Pass 2: same hostname or base domain match (www.youtube.com ↔ youtube.com)
    const baseDomain = targetHost.replace(/^(www|api)\./, '')
    for (const page of pages) {
      try {
        const pageHost = new URL(page.url()).hostname
        if (pageHost === baseDomain || pageHost === 'www.' + baseDomain || pageHost.endsWith('.' + baseDomain)) {
          return page
        }
      } catch { /* skip */ }
    }

    // Pass 3: same SLD match (bsky.social ↔ bsky.app shares "bsky" SLD prefix)
    // This handles cases like API at bsky.social, web app at bsky.app
    const sld = baseDomain.split('.')[0]
    if (sld && sld.length > 3) { // Only for non-trivial SLDs (skip "api", "www", etc.)
      for (const page of pages) {
        try {
          const pageHost = new URL(page.url()).hostname
          const pageSld = pageHost.replace(/^www\./, '').split('.')[0]
          if (pageSld === sld) return page
        } catch { /* skip */ }
      }
    }
  } catch { /* invalid serverUrl */ }
  return undefined
}

export function createNeedsPageError(serverUrl: string): OpenWebError {
  const pageHintUrl = getPageHintUrl(serverUrl)
  return new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `No open page matches ${pageHintUrl}`,
    action: `Open a tab to ${pageHintUrl} and retry.`,
    retriable: true,
    failureClass: 'needs_page',
  })
}

export function buildJsonRequestBody(operation: OpenApiOperation, params: Record<string, unknown>): string | undefined {
  const bodyParams = getRequestBodyParameters(operation)
  if (bodyParams.length === 0) {
    return undefined
  }

  const body: Record<string, unknown> = {}
  for (const param of bodyParams) {
    const value = params[param.name]
    if (value !== undefined) {
      body[param.name] = value
    }
  }

  return Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
}

/** Read x-openweb config from the server entry matching this operation */
export function getServerXOpenWeb(spec: OpenApiSpec, operation: OpenApiOperation): XOpenWebServer | undefined {
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) return undefined

  for (const server of spec.servers ?? []) {
    if (server.url === serverUrl) {
      return (server as Record<string, unknown>)['x-openweb'] as XOpenWebServer | undefined
    }
  }

  return undefined
}

/** Determine execution mode: operation-level overrides server-level */
export function resolveMode(spec: OpenApiSpec, operation: OpenApiOperation): ExecutionMode {
  const opExt = operation['x-openweb'] as Record<string, unknown> | undefined
  if (opExt?.mode) {
    const m = opExt.mode as string
    if (!VALID_MODES.has(m)) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unknown execution mode: ${m}`,
        action: 'Valid modes: direct_http, session_http, browser_fetch.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    return m as ExecutionMode
  }

  const serverExt = getServerXOpenWeb(spec, operation)
  const serverMode = serverExt?.mode ?? 'direct_http'
  if (!VALID_MODES.has(serverMode)) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Unknown execution mode: ${serverMode}`,
      action: 'Valid modes: direct_http, session_http, browser_fetch.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return serverMode as ExecutionMode
}

/** Substitute path parameters like {user_id} in the URL path */
export function substitutePath(
  pathTemplate: string,
  parameters: OpenApiParameter[] | undefined,
  params: Record<string, unknown>,
): string {
  let result = pathTemplate
  const pathParams = (parameters ?? []).filter((p) => p.in === 'path')

  for (const param of pathParams) {
    const value = params[param.name]
    if (value === undefined || value === null) {
      if (param.required !== false) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: `Missing required path parameter: ${param.name}`,
          action: 'Run `openweb <site> <tool>` to inspect parameters.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      continue
    }
    result = result.replace(`{${param.name}}`, encodeURIComponent(String(value)))
  }

  // Guard against unreplaced template variables (spec/params mismatch)
  const unreplaced = result.match(/\{[^}]+\}/g)
  if (unreplaced) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'INVALID_PARAMS',
      message: `Unresolved path variables: ${unreplaced.join(', ')}`,
      action: 'Provide values for all path parameters.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return result
}

/** Build headers from parameters with in=header (applying defaults) */
export function buildHeaderParams(
  parameters: OpenApiParameter[] | undefined,
  params: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerParams = (parameters ?? []).filter((p) => p.in === 'header')

  for (const param of headerParams) {
    const value = params[param.name] ?? param.schema?.default
    if (value === undefined || value === null) {
      if (param.required) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'INVALID_PARAMS',
          message: `Missing required header parameter: ${param.name}`,
          action: 'Run `openweb <site> <tool>` to inspect parameters.',
          retriable: false,
          failureClass: 'fatal',
        })
      }
      continue
    }
    headers[param.name] = String(value)
  }

  return headers
}

/** Resolve auth primitive to get cookies/headers to inject */
export async function resolveAuth(
  handle: BrowserHandle,
  auth: AuthPrimitive,
  serverUrl: string,
  deps?: SessionHttpDependencies,
): Promise<AuthResult> {
  switch (auth.type) {
    case 'cookie_session':
      return resolveCookieSession(handle, serverUrl)
    case 'localStorage_jwt':
      return resolveLocalStorageJwt(handle, {
        key: auth.key,
        path: auth.path,
        inject: auth.inject,
      })
    case 'page_global':
      return resolvePageGlobal(handle, {
        expression: auth.expression,
        inject: auth.inject,
        values: auth.values,
      })
    case 'exchange_chain':
      return resolveExchangeChain(handle, {
        steps: auth.steps,
        inject: auth.inject,
      }, serverUrl, { fetchImpl: deps?.fetchImpl, ssrfValidator: deps?.ssrfValidator })
    case 'webpack_module_walk':
      return resolveWebpackModuleWalk(handle, {
        chunk_global: auth.chunk_global,
        module_test: auth.module_test,
        call: auth.call,
        inject: auth.inject,
      })
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported auth primitive: ${auth.type}`,
        action: 'This auth type is not yet implemented.',
        retriable: false,
        failureClass: 'fatal',
      })
  }
}

/** Resolve CSRF primitive to get headers to inject */
export async function resolveCsrf(
  handle: BrowserHandle,
  csrf: CsrfPrimitive,
  serverUrl: string,
  deps?: SessionHttpDependencies & { authHeaders?: Record<string, string>; cookieString?: string },
): Promise<ResolvedInjections> {
  switch (csrf.type) {
    case 'cookie_to_header':
      return resolveCookieToHeader(handle, csrf, serverUrl)
    case 'meta_tag':
      return resolveMetaTag(handle, { name: csrf.name, header: csrf.header })
    case 'api_response':
      return resolveApiResponse(handle, {
        endpoint: csrf.endpoint,
        method: csrf.method,
        extract: csrf.extract,
        inject: csrf.inject,
        cache: csrf.cache,
      }, serverUrl, {
        fetchImpl: deps?.fetchImpl,
        authHeaders: deps?.authHeaders,
        cookieString: deps?.cookieString,
      })
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported CSRF primitive: ${csrf.type}`,
        action: 'This CSRF type is not yet implemented.',
        retriable: false,
        failureClass: 'fatal',
      })
  }
}

/** Resolve signing primitive to get headers to inject */
export async function resolveSigning(
  handle: BrowserHandle,
  signing: SigningPrimitive,
  serverUrl: string,
): Promise<ResolvedInjections> {
  switch (signing.type) {
    case 'sapisidhash':
      return resolveSapisidhash(handle, {
        cookie: signing.cookie,
        origin: signing.origin,
        inject: signing.inject,
      }, serverUrl)
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported signing primitive: ${signing.type}`,
        action: 'This signing type is not yet implemented.',
        retriable: false,
        failureClass: 'fatal',
      })
  }
}

export interface SessionHttpDependencies {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

export interface SessionHttpResult {
  readonly status: number
  readonly body: unknown
  readonly responseHeaders: Readonly<Record<string, string>>
}

/**
 * Execute an operation in session_http mode:
 * 1. Get browser handle from connected CDP browser
 * 2. Resolve auth primitive → cookies/headers
 * 3. Resolve CSRF primitive (mutations only) → headers
 * 4. Make HTTP request with injected credentials
 */
export async function executeSessionHttp(
  browser: Browser,
  spec: OpenApiSpec,
  operationPath: string,
  method: string,
  operation: OpenApiOperation,
  params: Record<string, unknown>,
  deps: SessionHttpDependencies = {},
): Promise<SessionHttpResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF

  const serverExt = getServerXOpenWeb(spec, operation)
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No server URL found in OpenAPI spec.',
      action: 'Add `servers` to the spec and retry.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const context = browser.contexts()[0]
  if (!context) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No browser context available. Is Chrome open with the site loaded?',
      action: 'Open Chrome with --remote-debugging-port=9222 and navigate to the site.',
      retriable: true,
      failureClass: 'needs_browser',
    })
  }

  const page = await findPageForOrigin(context, serverUrl)
  if (!page) {
    throw createNeedsPageError(serverUrl)
  }

  const handle: BrowserHandle = { page, context }
  const authResult = serverExt?.auth
    ? await resolveAuth(handle, serverExt.auth, serverUrl, deps)
    : undefined

  // Resolve all parameters into: path, query, header
  const allParams = resolveAllParameters(spec, operation)
  const inputParams = validateParams(
    [...allParams, ...getRequestBodyParameters(operation)],
    { ...params, ...authResult?.queryParams },
  )
  const resolvedPath = substitutePath(operationPath, allParams, inputParams)
  const headerParams = buildHeaderParams(allParams, inputParams)

  // Build URL with query params only
  const baseUrl = new URL(serverUrl)
  const fullPath = baseUrl.pathname.replace(/\/$/, '') + resolvedPath
  const target = new URL(fullPath, baseUrl.origin)
  const queryParams = allParams.filter((p) => p.in === 'query')
  for (const param of queryParams) {
    const value = inputParams[param.name]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        target.searchParams.append(param.name, String(item))
      }
    } else {
      target.searchParams.set(param.name, String(value))
    }
  }

  // Build request body from non-path/query/header params
  let jsonBody: string | undefined
  const upperMethod = method.toUpperCase()
  if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
    jsonBody = buildJsonRequestBody(operation, inputParams)
  }

  // Merge headers — session_http always sends Referer (many sites require it)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Referer: baseUrl.origin + '/',
    ...headerParams,
  }
  if (jsonBody) {
    headers['Content-Type'] = 'application/json'
  }

  // Resolve auth
  let cookieString: string | undefined
  if (authResult) {
    Object.assign(headers, authResult.headers)
    cookieString = authResult.cookieString

    // Inject auth query params (e.g., page_global may inject API key as query param)
    if (authResult.queryParams) {
      for (const [key, value] of Object.entries(authResult.queryParams)) {
        target.searchParams.set(key, value)
      }
    }
  }

  // Resolve CSRF (mutations only)
  const csrfConfig = serverExt?.csrf
  if (csrfConfig && MUTATION_METHODS.has(upperMethod)) {
    // Collect resolved auth headers (excluding Cookie) for api_response CSRF
    const authHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'cookie' && k.toLowerCase() !== 'accept' && k.toLowerCase() !== 'referer' && k.toLowerCase() !== 'content-type') {
        authHeaders[k] = v
      }
    }
    const csrfResult = await resolveCsrf(handle, csrfConfig, serverUrl, {
      ...deps,
      authHeaders,
      cookieString,
    })
    Object.assign(headers, csrfResult.headers)
  }

  // Resolve signing (per-request computation like SAPISIDHASH)
  if (serverExt?.signing) {
    const signingResult = await resolveSigning(handle, serverExt.signing, serverUrl)
    Object.assign(headers, signingResult.headers)
  }

  // Inject cookies
  if (cookieString) {
    headers.Cookie = cookieString
  }

  // Fetch with redirect following + SSRF validation
  const originalOrigin = new URL(target.toString()).origin
  let currentUrl = target.toString()
  let currentMethod = upperMethod
  let response: Response | undefined

  for (let attempt = 0; attempt < MAX_REDIRECTS; attempt++) {
    await ssrfValidator(currentUrl)

    response = await fetchImpl(currentUrl, {
      method: currentMethod,
      headers,
      body: currentMethod !== 'GET' && currentMethod !== 'HEAD' ? jsonBody : undefined,
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) break

    const location = response.headers.get('location')
    if (!location) break

    const nextUrl = new URL(location, currentUrl)
    currentUrl = nextUrl.toString()

    // CR-07: 303 See Other always switches to GET
    if (response.status === 303) {
      currentMethod = 'GET'
      jsonBody = undefined
    }

    // CR-01: Strip sensitive headers on cross-origin redirect
    if (nextUrl.origin !== originalOrigin) {
      for (const name of SENSITIVE_HEADERS) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === name) delete headers[key]
        }
      }
    }
  }

  if (!response) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No response received.',
      action: 'Check network connectivity.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (response.status >= 300 && response.status < 400) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Too many redirects (>${MAX_REDIRECTS})`,
      action: 'Retry later or inspect endpoint redirects.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (!response.ok) {
    const httpFailure = getHttpFailure(response.status)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `HTTP ${response.status}`,
      action: httpFailure.failureClass === 'needs_login'
        ? 'Log in to the site in Chrome and retry.'
        : 'Check parameters and endpoint availability.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
    })
  }

  // Parse JSON safely
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Response is not valid JSON (status ${response.status})`,
      action: 'The API returned non-JSON content. Check the endpoint.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  return { status: response.status, body, responseHeaders }
}

/** Collect parameters from operation + $ref components resolution */
export function resolveAllParameters(spec: OpenApiSpec, operation: OpenApiOperation): OpenApiParameter[] {
  const params = operation.parameters ?? []
  return params.flatMap((p) => {
    const ref = (p as unknown as Record<string, unknown>)['$ref'] as string | undefined
    if (!ref) return [p]

    // Resolve $ref like '#/components/parameters/X-IG-App-ID'
    const parts = ref.replace('#/', '').split('/')
    if (parts.some((part) => UNSAFE_REF_SEGMENTS.has(part))) return []
    let resolved: unknown = spec
    for (const part of parts) {
      resolved = (resolved as Record<string, unknown>)?.[part]
    }

    if (!resolved || typeof resolved !== 'object') return []
    return [resolved as OpenApiParameter]
  })
}
