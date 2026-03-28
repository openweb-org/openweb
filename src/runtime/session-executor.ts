import type { Browser, BrowserContext, Page } from 'playwright-core'

import { formatCookieString } from '../lib/cookies.js'
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { getRequestBodyParameters, validateParams, type OpenApiOperation, type OpenApiSpec } from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'
import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import { parseResponseBody } from '../lib/response-parser.js'
import { resolveAuth, resolveCsrf, resolveSigning } from './primitives/index.js'
import type { BrowserHandle } from './primitives/types.js'
import { resolveAllParameters, substitutePath, buildHeaderParams, buildJsonRequestBody, buildTargetUrl } from './request-builder.js'
import { getServerXOpenWeb } from './operation-context.js'
import type { ExecutorResult } from './executor-result.js'
import { fetchWithRedirects } from './redirect.js'
import { listCandidatePages } from './page-candidates.js'
import { logger } from '../lib/logger.js'

function getPageHintUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl)
    if (url.hostname.startsWith('api.')) {
      const pageUrl = new URL(url.toString())
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

/** Find a page whose URL matches the target server origin */
export async function findPageForOrigin(context: BrowserContext, serverUrl: string): Promise<Page | undefined> {
  try {
    const targetOrigin = new URL(serverUrl).origin
    const targetHost = new URL(serverUrl).hostname
    const pages = await listCandidatePages(context)

    for (const page of pages) {
      try { if (page.url().startsWith(targetOrigin)) return page } catch { /* skip */ }
    }

    const baseDomain = targetHost.replace(/^(www|api|oauth)\./, '')
    for (const page of pages) {
      try {
        const pageHost = new URL(page.url()).hostname
        if (pageHost === baseDomain || pageHost === `www.${baseDomain}` || pageHost.endsWith(`.${baseDomain}`)) return page
      } catch { /* skip */ }
    }

    const sld = baseDomain.split('.')[0]
    if (sld && sld.length > 3) {
      for (const page of pages) {
        try {
          const pageSld = new URL(page.url()).hostname.replace(/^www\./, '').split('.')[0]
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

/** Auto-navigate to site URL when no matching page exists */
export async function autoNavigate(context: BrowserContext, serverUrl: string): Promise<Page | undefined> {
  const siteUrl = getPageHintUrl(serverUrl)
  try {
    logger.debug(`auto-navigating to ${siteUrl}`)
    const newPage = await context.newPage()
    await newPage.goto(siteUrl, { waitUntil: 'networkidle', timeout: 15_000 })
    return await findPageForOrigin(context, serverUrl)
  } catch (err) {
    logger.debug(`auto-navigation failed: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

export interface SessionHttpDependencies {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

export type { ExecutorResult }

/**
 * Execute an operation via node transport with browser auth:
 * 1. Resolve auth/CSRF/signing via registry
 * 2. Build request with injected credentials
 * 3. Fetch with redirect following
 * 4. Parse response
 */
export async function executeSessionHttp(
  browser: Browser,
  spec: OpenApiSpec,
  operationPath: string,
  method: string,
  operation: OpenApiOperation,
  params: Record<string, unknown>,
  deps: SessionHttpDependencies = {},
): Promise<ExecutorResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF
  const serverExt = getServerXOpenWeb(spec, operation)
  const serverUrl = operation.servers?.[0]?.url ?? spec.servers?.[0]?.url
  if (!serverUrl) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: 'No server URL found in OpenAPI spec.',
      action: 'Add `servers` to the spec and retry.',
      retriable: false, failureClass: 'fatal',
    })
  }

  const context = browser.contexts()[0]
  if (!context) {
    throw new OpenWebError({
      error: 'execution_failed', code: 'EXECUTION_FAILED',
      message: 'No browser context available. Is Chrome open with the site loaded?',
      action: 'Run: openweb browser start',
      retriable: true, failureClass: 'needs_browser',
    })
  }

  let page = await findPageForOrigin(context, serverUrl)
  if (!page) {
    page = await autoNavigate(context, serverUrl)
  }
  if (!page) throw createNeedsPageError(serverUrl)
  const handle: BrowserHandle = { page, context }

  // 1. Resolve auth
  const authResult = serverExt?.auth
    ? await resolveAuth(handle, serverExt.auth, serverUrl, deps)
    : undefined

  // 2. Build request
  const allParams = resolveAllParameters(spec, operation)
  const inputParams = validateParams(
    [...allParams, ...getRequestBodyParameters(operation)],
    { ...params, ...authResult?.queryParams },
  )
  const resolvedPath = substitutePath(operationPath, allParams, inputParams)
  const target = buildTargetUrl(serverUrl, resolvedPath, allParams, inputParams)

  const upperMethod = method.toUpperCase()
  let jsonBody: string | undefined
  if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
    jsonBody = buildJsonRequestBody(operation, inputParams)
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Referer: `${target.origin}/`,
    ...buildHeaderParams(allParams, inputParams),
  }
  if (jsonBody) headers['Content-Type'] = 'application/json'

  let cookieString: string | undefined
  if (authResult) {
    Object.assign(headers, authResult.headers)
    cookieString = authResult.cookieString
    if (authResult.queryParams) {
      for (const [key, value] of Object.entries(authResult.queryParams)) target.searchParams.set(key, value)
    }
  }

  // D-14: node transport always sends browser cookies
  if (!cookieString) {
    const browserCookies = await context.cookies(serverUrl)
    if (browserCookies.length > 0) cookieString = formatCookieString(browserCookies)
  }

  // 3. Resolve CSRF
  if (serverExt?.csrf) {
    const csrfScope = (serverExt.csrf as Record<string, unknown>).scope as string[] | undefined
    if (shouldApplyCsrf(csrfScope, upperMethod)) {
      const authHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(headers)) {
        if (!['cookie', 'accept', 'referer', 'content-type'].includes(k.toLowerCase())) authHeaders[k] = v
      }
      Object.assign(headers, (await resolveCsrf(handle, serverExt.csrf, serverUrl, { ...deps, authHeaders, cookieString })).headers)
    }
  }

  // 4. Resolve signing
  if (serverExt?.signing) Object.assign(headers, (await resolveSigning(handle, serverExt.signing, serverUrl, deps)).headers)
  if (cookieString) headers.Cookie = cookieString

  // 5. Fetch with redirects
  const response = await fetchWithRedirects(target.toString(), upperMethod, headers, jsonBody, { fetchImpl, ssrfValidator })

  if (!response.ok) {
    const httpFailure = getHttpFailure(response.status)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `HTTP ${response.status}`,
      action: httpFailure.failureClass === 'needs_login'
        ? 'Run: openweb login <site>, then: openweb browser restart'
        : 'Check parameters and endpoint availability.',
      retriable: httpFailure.retriable, failureClass: httpFailure.failureClass,
    })
  }

  // 6. Parse response
  const text = await response.text()
  const body = parseResponseBody(text, response.headers.get('content-type'), response.status)
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { responseHeaders[key] = value })
  return { status: response.status, body, responseHeaders }
}
