import type { Browser, BrowserContext, Page } from 'patchright'

import { formatCookieString } from '../lib/cookies.js'
import { DEFAULT_USER_AGENT, TIMEOUT } from '../lib/config.js'
import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { validateParams } from '../lib/param-validator.js'
import { type OpenApiOperation, type OpenApiSpec, getRequestBodyParameters } from '../lib/spec-loader.js'
import { parseResponseBody } from '../lib/response-parser.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { ExecutorResult } from './executor-result.js'
import { getServerXOpenWeb } from './operation-context.js'
import { listCandidatePages } from './page-candidates.js'
import { resolveAuth, resolveCsrf, resolveSigning } from './primitives/index.js'
import type { BrowserHandle } from './primitives/types.js'
import { fetchWithRedirects } from './redirect.js'
import { buildHeaderParams, buildJsonRequestBody, buildTargetUrl, resolveAllParameters, substitutePath } from './request-builder.js'
import { applyResponseUnwrap } from './response-unwrap.js'
import { ensurePagePolyfills } from './page-polyfill.js'

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
        // Suffix-match: target is a subdomain of the page (e.g. amp-api.podcasts.apple.com → podcasts.apple.com)
        if (targetHost.endsWith(`.${pageHost}`)) return page
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

export interface AutoNavigateResult {
  page: Page
  /** true if this page was created by autoNavigate (caller must close it) */
  owned: boolean
}

/** Try to get the parent domain for subdomain fallback navigation.
 *  Returns undefined when the hostname has no strippable subdomain
 *  (e.g. already a bare domain or www-prefixed). */
function getParentDomainUrl(serverUrl: string): string | undefined {
  try {
    const url = new URL(serverUrl)
    const parts = url.hostname.split('.')
    // Need at least 3 parts (sub.domain.tld) and the sub must not be www
    if (parts.length < 3 || parts[0] === 'www') return undefined
    const parentHost = parts.slice(1).join('.')
    return `${url.protocol}//${parentHost}/`
  } catch { return undefined }
}

/** Auto-navigate to site URL when no matching page exists.
 *  Falls back to the parent domain when a subdomain returns HTTP 4xx+. */
export async function autoNavigate(context: BrowserContext, serverUrl: string): Promise<AutoNavigateResult | undefined> {
  const siteUrl = getPageHintUrl(serverUrl)

  /** Navigate to a URL, return { page, response status } or undefined on hard failure. */
  const tryNavigate = async (url: string): Promise<{ page: Page; status: number | null } | undefined> => {
    const newPage = await context.newPage()
    try {
      const response = await newPage.goto(url, { waitUntil: 'load', timeout: 15_000 })
      return { page: newPage, status: response?.status() ?? null }
    } catch (navErr) {
      await newPage.close().catch(() => {})
      logger.debug(`auto-navigation failed for ${url}: ${navErr instanceof Error ? navErr.message : String(navErr)}`)
      return undefined
    }
  }

  try {
    logger.debug(`auto-navigating to ${siteUrl}`)
    let nav = await tryNavigate(siteUrl)

    // Fallback: if the page returned an HTTP error (e.g. API-only subdomain
    // like stock.xueqiu.com), try the parent domain where cookies are set.
    if (nav && nav.status !== null && nav.status >= 400) {
      const parentUrl = getParentDomainUrl(serverUrl)
      if (parentUrl && parentUrl !== siteUrl) {
        logger.debug(`subdomain returned ${nav.status}, falling back to parent domain ${parentUrl}`)
        await nav.page.close().catch(() => {})
        nav = await tryNavigate(parentUrl)
      }
    }

    if (!nav) return undefined

    // Settle wait: SPAs redirect during load; need stable URL for findPageForOrigin
    await new Promise(r => setTimeout(r, TIMEOUT.spaSettle))
    const matched = await findPageForOrigin(context, serverUrl)
    if (!matched) {
      await nav.page.close().catch(() => {})
      return undefined
    }
    // If findPageForOrigin returned a different page, close the one we created
    if (matched !== nav.page) {
      await nav.page.close().catch(() => {})
    }
    return { page: matched, owned: matched === nav.page }
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
  let ownedPage = false
  if (!page) {
    const nav = await autoNavigate(context, serverUrl)
    if (nav) { page = nav.page; ownedPage = nav.owned }
  }
  if (!page) throw createNeedsPageError(serverUrl)

  try {
    await ensurePagePolyfills(page)
    const handle: BrowserHandle = { page, context }

    // 1. Resolve auth
    const authResult = serverExt?.auth
      ? await resolveAuth(handle, serverExt.auth, serverUrl, { ...deps, ssrfValidator })
      : undefined

    // 2. Build request
    const allParams = resolveAllParameters(spec, operation)
    const inputParams = validateParams(
      [...allParams, ...getRequestBodyParameters(operation)],
      { ...params, ...authResult?.queryParams },
    )
    const resolvedPath = substitutePath(operationPath, allParams, inputParams)
    const target = buildTargetUrl(serverUrl, resolvedPath, allParams, inputParams, authResult?.queryParams)

    const upperMethod = method.toUpperCase()
    let jsonBody: string | undefined
    if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
      jsonBody = buildJsonRequestBody(operation, inputParams)
    }

    const serverOrigin = new URL(serverUrl).origin
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
      Referer: `${serverOrigin}/`,
      ...buildHeaderParams(allParams, inputParams),
    }
    if (jsonBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json'

    let cookieString: string | undefined
    if (authResult) {
      Object.assign(headers, authResult.headers)
      cookieString = authResult.cookieString
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
        Object.assign(headers, (await resolveCsrf(handle, serverExt.csrf, serverUrl, { ...deps, ssrfValidator, authHeaders, cookieString })).headers)
      }
    }

    // 4. Resolve signing
    if (serverExt?.signing) Object.assign(headers, (await resolveSigning(handle, serverExt.signing, serverUrl, { ...deps, ssrfValidator })).headers)
    if (cookieString) headers.Cookie = cookieString

    // 5. Fetch with redirects
    const response = await fetchWithRedirects(target, upperMethod, headers, jsonBody, { fetchImpl, ssrfValidator })

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
    const rawBody = parseResponseBody(text, response.headers.get('content-type'), response.status)
    const body = applyResponseUnwrap(rawBody, operation)
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })
    return { status: response.status, body, responseHeaders }
  } finally {
    if (ownedPage) await page.close().catch(() => {})
  }
}
