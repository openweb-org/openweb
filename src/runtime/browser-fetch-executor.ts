import type { Browser } from 'playwright'

import { OpenWebError } from '../lib/errors.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { OpenApiOperation, OpenApiSpec } from '../lib/openapi.js'
import type { BrowserHandle } from './primitives/types.js'
import {
  findPageForOrigin,
  getServerXOpenWeb,
  resolveAllParameters,
  resolveAuth,
  resolveCsrf,
  resolveSigning,
  substitutePath,
  buildHeaderParams,
  type SessionHttpDependencies,
} from './session-executor.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface BrowserFetchResult {
  readonly status: number
  readonly body: unknown
  readonly responseHeaders: Readonly<Record<string, string>>
}

/**
 * Execute an operation in browser_fetch mode:
 * Same auth/CSRF/signing pipeline as session_http, but the final
 * HTTP request runs inside page.evaluate(fetch(...)) — this leverages
 * the browser's cookies, TLS fingerprint, and CORS context.
 */
export async function executeBrowserFetch(
  browser: Browser,
  spec: OpenApiSpec,
  operationPath: string,
  method: string,
  operation: OpenApiOperation,
  params: Record<string, unknown>,
  deps: SessionHttpDependencies = {},
): Promise<BrowserFetchResult> {
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

  const page = findPageForOrigin(context, serverUrl) ?? context.pages()[0]
  if (!page) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No page available in browser context.',
      action: 'Open a tab in Chrome and navigate to the site.',
      retriable: true,
      failureClass: 'needs_page',
    })
  }

  const handle: BrowserHandle = { page, context }

  // Resolve parameters
  const allParams = resolveAllParameters(spec, operation)
  const resolvedPath = substitutePath(operationPath, allParams, params)
  const headerParams = buildHeaderParams(allParams, params)

  // Build URL
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

  // Build request body
  let jsonBody: string | undefined
  const upperMethod = method.toUpperCase()
  if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
    const consumedParams = new Set(allParams.map((p) => p.name))
    const bodyParams: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (!consumedParams.has(key)) {
        bodyParams[key] = value
      }
    }
    if (Object.keys(bodyParams).length > 0) {
      jsonBody = JSON.stringify(bodyParams)
    }
  }

  // Build headers — browser_fetch does NOT need Cookie header (credentials:'include' handles it)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...headerParams,
  }
  if (jsonBody) {
    headers['Content-Type'] = 'application/json'
  }

  // Resolve auth (headers + query params, but skip cookie injection)
  if (serverExt?.auth) {
    const authResult = await resolveAuth(handle, serverExt.auth, serverUrl, deps)
    Object.assign(headers, authResult.headers)
    if (authResult.queryParams) {
      for (const [key, value] of Object.entries(authResult.queryParams)) {
        target.searchParams.set(key, value)
      }
    }
    // Note: cookieString is NOT injected — browser handles cookies via credentials:'include'
  }

  // Resolve CSRF (mutations only)
  if (serverExt?.csrf && MUTATION_METHODS.has(upperMethod)) {
    const authHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'accept' && k.toLowerCase() !== 'content-type') {
        authHeaders[k] = v
      }
    }
    const csrfResult = await resolveCsrf(handle, serverExt.csrf, serverUrl, {
      ...deps,
      authHeaders,
    })
    Object.assign(headers, csrfResult.headers)
  }

  // Resolve signing
  if (serverExt?.signing) {
    const signingResult = await resolveSigning(handle, serverExt.signing, serverUrl)
    Object.assign(headers, signingResult.headers)
  }

  // SSRF: validate the initial URL before handing to browser context.
  // Redirect safety is delegated to the browser's own network stack (CORS,
  // mixed-content blocking). Browser-context fetch with redirect:'manual'
  // returns opaqueredirect (status 0, no headers) — unusable for per-hop
  // validation. This is the correct model: browser_fetch exists precisely
  // because we need browser-native request behavior.
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF
  await ssrfValidator(target.toString())

  // Execute fetch inside the browser page context
  let fetchResult: { status: number; headers: Record<string, string>; text: string }
  try {
    fetchResult = await page.evaluate(
      async (args: { url: string; method: string; headers: Record<string, string>; body: string | undefined }) => {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.method !== 'GET' && args.method !== 'HEAD' ? args.body : undefined,
          credentials: 'include',
        })
        const respHeaders: Record<string, string> = {}
        resp.headers.forEach((v, k) => { respHeaders[k] = v })
        const text = await resp.text()
        return { status: resp.status, headers: respHeaders, text }
      },
      { url: target.toString(), method: upperMethod, headers, body: jsonBody },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `browser_fetch failed: ${message}`,
      action: 'Check network connectivity and CORS policy.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (fetchResult.status >= 400) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `HTTP ${String(fetchResult.status)}`,
      action: 'Check parameters and ensure you are logged in.',
      retriable: fetchResult.status === 429 || fetchResult.status >= 500,
      failureClass: fetchResult.status === 429 || fetchResult.status >= 500 ? 'retriable' : 'fatal',
    })
  }

  let body: unknown
  try {
    body = JSON.parse(fetchResult.text) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Response is not valid JSON (status ${String(fetchResult.status)})`,
      action: 'The API returned non-JSON content. Check the endpoint.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return { status: fetchResult.status, body, responseHeaders: fetchResult.headers }
}
