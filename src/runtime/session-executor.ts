import type { Browser } from 'playwright'

import { OpenWebError } from '../lib/errors.js'
import type { OpenApiOperation, OpenApiParameter, OpenApiSpec } from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { AuthPrimitive, CsrfPrimitive } from '../types/primitives.js'
import type { ExecutionMode, XOpenWebServer } from '../types/extensions.js'
import { resolveCookieSession } from './primitives/cookie-session.js'
import { resolveCookieToHeader } from './primitives/cookie-to-header.js'
import type { BrowserHandle, ResolvedInjections } from './primitives/types.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_REDIRECTS = 5

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
  if (opExt?.mode) return opExt.mode as ExecutionMode

  const serverExt = getServerXOpenWeb(spec, operation)
  return serverExt?.mode ?? 'direct_http'
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
        })
      }
      continue
    }
    result = result.replace(`{${param.name}}`, encodeURIComponent(String(value)))
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
        })
      }
      continue
    }
    headers[param.name] = String(value)
  }

  return headers
}

/** Resolve auth primitive to get cookies/headers to inject */
async function resolveAuth(handle: BrowserHandle, auth: AuthPrimitive, serverUrl: string): Promise<ResolvedInjections> {
  switch (auth.type) {
    case 'cookie_session':
      return resolveCookieSession(handle, serverUrl)
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported auth primitive: ${auth.type}`,
        action: 'This auth type is not yet implemented.',
        retriable: false,
      })
  }
}

/** Resolve CSRF primitive to get headers to inject */
async function resolveCsrf(handle: BrowserHandle, csrf: CsrfPrimitive, serverUrl: string): Promise<ResolvedInjections> {
  switch (csrf.type) {
    case 'cookie_to_header':
      return resolveCookieToHeader(handle, csrf, serverUrl)
    default:
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Unsupported CSRF primitive: ${csrf.type}`,
        action: 'This CSRF type is not yet implemented.',
        retriable: false,
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
  const context = browser.contexts()[0]
  if (!context) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No browser context available. Is Chrome open with the site loaded?',
      action: 'Open Chrome with --remote-debugging-port=9222 and navigate to the site.',
      retriable: true,
    })
  }

  const page = context.pages()[0]
  if (!page) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No page available in browser context.',
      action: 'Open a tab in Chrome and navigate to the site.',
      retriable: true,
    })
  }

  const handle: BrowserHandle = { page, context }

  // Resolve all parameters into: path, query, header
  const allParams = resolveAllParameters(spec, operation)
  const resolvedPath = substitutePath(operationPath, allParams, params)
  const headerParams = buildHeaderParams(allParams, params)

  // Build URL with query params only
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No server URL found in OpenAPI spec.',
      action: 'Add `servers` to the spec and retry.',
      retriable: false,
    })
  }

  const baseUrl = new URL(serverUrl)
  const fullPath = baseUrl.pathname.replace(/\/$/, '') + resolvedPath
  const target = new URL(fullPath, baseUrl.origin)
  const queryParams = allParams.filter((p) => p.in === 'query')
  for (const param of queryParams) {
    const value = params[param.name]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        target.searchParams.append(param.name, String(item))
      }
    } else {
      target.searchParams.set(param.name, String(value))
    }
  }

  // Merge headers — session_http always sends Referer (many sites require it)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Referer: baseUrl.origin + '/',
    ...headerParams,
  }

  // Resolve auth
  let cookieString: string | undefined
  if (serverExt?.auth) {
    const authResult = await resolveAuth(handle, serverExt.auth, serverUrl)
    Object.assign(headers, authResult.headers)
    cookieString = authResult.cookieString
  }

  // Resolve CSRF (mutations only)
  const upperMethod = method.toUpperCase()
  const csrfConfig = serverExt?.csrf
  if (csrfConfig && MUTATION_METHODS.has(upperMethod)) {
    const csrfResult = await resolveCsrf(handle, csrfConfig, serverUrl)
    Object.assign(headers, csrfResult.headers)
  }

  // Inject cookies
  if (cookieString) {
    headers.Cookie = cookieString
  }

  // Fetch with redirect following + SSRF validation
  let currentUrl = target.toString()
  let response: Response | undefined

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    await ssrfValidator(currentUrl)

    response = await fetchImpl(currentUrl, {
      method: upperMethod,
      headers,
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) break

    const location = response.headers.get('location')
    if (!location) break
    currentUrl = new URL(location, currentUrl).toString()
  }

  if (!response) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No response received.',
      action: 'Check network connectivity.',
      retriable: true,
    })
  }

  if (!response.ok) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `HTTP ${response.status}`,
      action: 'Check parameters and ensure you are logged in.',
      retriable: response.status === 429 || response.status >= 500,
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
    })
  }

  return { status: response.status, body }
}

/** Collect parameters from operation + $ref components resolution */
function resolveAllParameters(spec: OpenApiSpec, operation: OpenApiOperation): OpenApiParameter[] {
  const params = operation.parameters ?? []
  return params.flatMap((p) => {
    const ref = (p as unknown as Record<string, unknown>)['$ref'] as string | undefined
    if (!ref) return [p]

    // Resolve $ref like '#/components/parameters/X-IG-App-ID'
    const parts = ref.replace('#/', '').split('/')
    let resolved: unknown = spec
    for (const part of parts) {
      resolved = (resolved as Record<string, unknown>)?.[part]
    }

    if (!resolved || typeof resolved !== 'object') return []
    return [resolved as OpenApiParameter]
  })
}
