import type { Browser } from 'patchright'

import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { type OpenApiOperation, type OpenApiSpec, getRequestBodyParameters, validateParams } from '../lib/openapi.js'
import { parseResponseBody } from '../lib/response-parser.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { ExecutorResult } from './executor-result.js'
import { getServerXOpenWeb } from './operation-context.js'
import { ensurePagePolyfills } from './page-polyfill.js'
import { resolveAuth, resolveCsrf, resolveSigning } from './primitives/index.js'
import type { BrowserHandle } from './primitives/types.js'
import { buildHeaderParams, buildJsonRequestBody, buildTargetUrl, resolveAllParameters, substitutePath } from './request-builder.js'
import {
  type AutoNavigateResult,
  type SessionHttpDependencies,
  autoNavigate,
  createNeedsPageError,
  findPageForOrigin,
} from './session-executor.js'
import { warmSession } from './warm-session.js'

// ── Bot-detection block detection ───────────────

/** Known bot-detection vendors and their response body markers. */
const BOT_DETECTION_MARKERS = [
  'blockScript',    // PerimeterX
  'captcha.js',     // PerimeterX CAPTCHA
  'geo.captcha-delivery.com', // DataDome
  'intr-page',      // Akamai Bot Manager
  'challenge-platform', // Cloudflare
] as const

/**
 * Check if a 403 response body is a bot-detection challenge,
 * not a genuine authentication/authorization failure.
 */
function isBotDetectionBlock(responseText: string): boolean {
  if (!responseText) return false
  return BOT_DETECTION_MARKERS.some(marker => responseText.includes(marker))
}

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
  let ownedPage = false
  if (!page) {
    const nav = await autoNavigate(context, serverUrl)
    if (nav) { page = nav.page; ownedPage = nav.owned }
  }
  if (!page) {
    throw createNeedsPageError(serverUrl)
  }

  try {
    await ensurePagePolyfills(page)

    // Warm session: let bot-detection sensors (PerimeterX, Akamai, DataDome)
    // generate valid cookies before issuing the API request.
    await warmSession(page, serverUrl)

    const ssrfValidator = deps.ssrfValidator ?? validateSSRF
    const handle: BrowserHandle = { page, context }
    const authResult = serverExt?.auth
      ? await resolveAuth(handle, serverExt.auth, serverUrl, { ...deps, ssrfValidator })
      : undefined

    // Resolve parameters
    const allParams = resolveAllParameters(spec, operation)
    const inputParams = validateParams(
      [...allParams, ...getRequestBodyParameters(operation)],
      { ...params, ...authResult?.queryParams },
    )
    const resolvedPath = substitutePath(operationPath, allParams, inputParams)
    const headerParams = buildHeaderParams(allParams, inputParams)

    // Build URL (returns raw string with minimal encoding)
    const target = buildTargetUrl(serverUrl, resolvedPath, allParams, inputParams, authResult?.queryParams)

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

    // Resolve auth headers (query params already handled by buildTargetUrl)
    if (authResult) {
      Object.assign(headers, authResult.headers)
      // Note: cookieString is NOT injected — browser handles cookies via credentials:'include'
    }

    // Resolve CSRF (always by default, or restricted by explicit scope)
    if (serverExt?.csrf) {
      const csrfScope = (serverExt.csrf as Record<string, unknown>).scope as string[] | undefined
      if (shouldApplyCsrf(csrfScope, upperMethod)) {
        const authHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() !== 'accept' && k.toLowerCase() !== 'content-type') {
            authHeaders[k] = v
          }
        }
        const csrfResult = await resolveCsrf(handle, serverExt.csrf, serverUrl, {
          ...deps,
          ssrfValidator,
          authHeaders,
        })
        Object.assign(headers, csrfResult.headers)
      }
    }

    // Resolve signing
    if (serverExt?.signing) {
      const signingResult = await resolveSigning(handle, serverExt.signing, serverUrl, { ...deps, ssrfValidator })
      Object.assign(headers, signingResult.headers)
    }

    // SSRF: validate the initial URL before handing to browser context.
    // Redirect safety is delegated to the browser's own network stack (CORS,
    // mixed-content blocking). Browser-context fetch with redirect:'manual'
    // returns opaqueredirect (status 0, no headers) — unusable for per-hop
    // validation. This is the correct model: browser_fetch exists precisely
    // because we need browser-native request behavior.
    await ssrfValidator(target)

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
        { url: target, method: upperMethod, headers, body: jsonBody },
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
      // Distinguish bot-detection 403 from genuine auth failure
      if (fetchResult.status === 403 && isBotDetectionBlock(fetchResult.text)) {
        logger.debug('browser_fetch: bot-detection block detected (not auth failure)')
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: 'Bot detection blocked the request (CAPTCHA challenge)',
          action: 'Run: openweb browser restart --no-headless, solve the CAPTCHA, then retry.',
          retriable: true,
          failureClass: 'bot_blocked',
        })
      }
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

    const body = parseResponseBody(fetchResult.text, fetchResult.headers['content-type'] ?? null, fetchResult.status)

    return { status: fetchResult.status, body, responseHeaders: fetchResult.headers }
  } finally {
    if (ownedPage) await page.close().catch(() => {})
  }
}
