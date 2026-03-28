import type { Browser } from 'playwright-core'

import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { getRequestBodyParameters, validateParams, type OpenApiOperation, type OpenApiSpec } from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { BrowserHandle } from './primitives/types.js'
import type { ExecutorResult } from './executor-result.js'
import {
  createNeedsPageError,
  findPageForOrigin,
  autoNavigate,
  type SessionHttpDependencies,
} from './session-executor.js'
import { getServerXOpenWeb } from './operation-context.js'
import { buildJsonRequestBody, resolveAllParameters, substitutePath, buildHeaderParams, buildTargetUrl } from './request-builder.js'
import { resolveAuth, resolveCsrf, resolveSigning } from './primitives/index.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type { ExecutorResult }

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
): Promise<ExecutorResult> {
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
      action: 'Run: openweb browser start',
      retriable: true,
      failureClass: 'needs_browser',
    })
  }

  let page = await findPageForOrigin(context, serverUrl)
  if (!page) {
    page = await autoNavigate(context, serverUrl)
  }
  if (!page) {
    throw createNeedsPageError(serverUrl)
  }

  const handle: BrowserHandle = { page, context }
  const authResult = serverExt?.auth
    ? await resolveAuth(handle, serverExt.auth, serverUrl, deps)
    : undefined

  // Resolve parameters
  const allParams = resolveAllParameters(spec, operation)
  const inputParams = validateParams(
    [...allParams, ...getRequestBodyParameters(operation)],
    { ...params, ...authResult?.queryParams },
  )
  const resolvedPath = substitutePath(operationPath, allParams, inputParams)
  const headerParams = buildHeaderParams(allParams, inputParams)

  // Build URL
  const target = buildTargetUrl(serverUrl, resolvedPath, allParams, inputParams)

  // Build request body
  let jsonBody: string | undefined
  const upperMethod = method.toUpperCase()
  if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
    jsonBody = buildJsonRequestBody(operation, inputParams)
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
  if (authResult) {
    Object.assign(headers, authResult.headers)
    if (authResult.queryParams) {
      for (const [key, value] of Object.entries(authResult.queryParams)) {
        target.searchParams.set(key, value)
      }
    }
    // Note: cookieString is NOT injected — browser handles cookies via credentials:'include'
  }

  // Resolve CSRF (mutations by default, or any method if scope is defined)
  if (serverExt?.csrf) {
    const csrfScope = (serverExt.csrf as Record<string, unknown>).scope as string[] | undefined
    const shouldResolveCsrf = csrfScope
      ? csrfScope.some((s) => s.toUpperCase() === upperMethod)
      : MUTATION_METHODS.has(upperMethod)

    if (shouldResolveCsrf) {
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
  }

  // Resolve signing
  if (serverExt?.signing) {
    const signingResult = await resolveSigning(handle, serverExt.signing, serverUrl, deps)
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
    const httpFailure = getHttpFailure(fetchResult.status)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `HTTP ${String(fetchResult.status)}`,
      action: httpFailure.failureClass === 'needs_login'
        ? 'Run: openweb login <site>, then: openweb browser restart'
        : 'Check parameters and endpoint availability.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
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
