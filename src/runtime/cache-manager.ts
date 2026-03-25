import type { Browser } from 'playwright-core'

import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import {
  getRequestBodyParameters,
  getServerUrl,
  validateParams,
  type OpenApiOperation,
  type OpenApiSpec,
} from '../lib/openapi.js'
import { validateSSRF } from '../lib/ssrf.js'
import { fetchWithRedirects } from './redirect.js'
import { readTokenCache, writeTokenCache, clearTokenCache, DEFAULT_TTL_SECONDS, extractJwtExp, type CachedTokens } from './token-cache.js'
import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import { buildHeaderParams, buildJsonRequestBody, resolveAllParameters, substitutePath } from './request-builder.js'
import type { ExecuteDependencies } from './http-executor.js'
import type { XOpenWebServer } from '../types/extensions.js'

/** Execute a request using cached cookies instead of browser extraction */
export async function executeCachedFetch(
  spec: OpenApiSpec,
  operationRef: { path: string; method: string; operation: OpenApiOperation },
  serverExt: XOpenWebServer | undefined,
  params: Record<string, unknown>,
  cached: CachedTokens,
  deps: ExecuteDependencies,
): Promise<{ status: number; body: unknown; responseHeaders: Record<string, string> }> {
  const serverUrl = getServerUrl(spec, operationRef.operation)
  const allParams = resolveAllParameters(spec, operationRef.operation)
  const inputParams = validateParams(
    [...allParams, ...getRequestBodyParameters(operationRef.operation)],
    params,
  )
  const resolvedPath = substitutePath(operationRef.path, allParams, inputParams)
  const url = (await import('../lib/openapi.js')).buildQueryUrl(serverUrl, resolvedPath, allParams, inputParams)
  const requestHeaders = buildHeaderParams(allParams, inputParams)

  // Inject cached cookies
  const cookieStr = cached.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  if (cookieStr) requestHeaders.Cookie = cookieStr

  // Reconstruct auth headers from cached localStorage (localStorage_jwt)
  const auth = serverExt?.auth
  if (auth?.type === 'localStorage_jwt' && Object.keys(cached.localStorage).length > 0) {
    const authConfig = auth as { key: string; path?: string; inject: { header?: string; prefix?: string; query?: string } }
    const raw = cached.localStorage[authConfig.key]
    if (raw) {
      let value: unknown
      try { value = JSON.parse(raw) } catch { value = raw }
      if (authConfig.path) {
        for (const seg of authConfig.path.split('.')) {
          if (value && typeof value === 'object') value = (value as Record<string, unknown>)[seg]
          else { value = undefined; break }
        }
      }
      if (typeof value === 'string' && value) {
        if (authConfig.inject.header) {
          requestHeaders[authConfig.inject.header] = (authConfig.inject.prefix ?? '') + value
        }
      }
    }
  }

  // Derive CSRF from cached cookies if applicable
  const csrf = serverExt?.csrf
  if (csrf?.type === 'cookie_to_header' && shouldApplyCsrf(csrf.scope, operationRef.method)) {
    const csrfCookie = cached.cookies.find((c) => c.name === csrf.cookie)
    if (csrfCookie) {
      requestHeaders[csrf.header] = csrfCookie.value
    }
  }

  const upperMethod = operationRef.method.toUpperCase()
  const jsonBody = upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH'
    ? buildJsonRequestBody(operationRef.operation, inputParams)
    : undefined
  if (jsonBody) requestHeaders['Content-Type'] = 'application/json'

  const response = await fetchWithRedirects(url, upperMethod, { Accept: 'application/json', ...requestHeaders }, jsonBody, {
    fetchImpl: deps.fetchImpl ?? fetch,
    ssrfValidator: deps.ssrfValidator ?? validateSSRF,
  })

  if (!response.ok) {
    const httpFailure = getHttpFailure(response.status)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `HTTP ${response.status}`,
      action: 'Cached credentials may have expired.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
    })
  }

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { responseHeaders[key] = value })

  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Response is not valid JSON (status ${response.status})`,
      action: 'The API returned non-JSON content.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return { status: response.status, body, responseHeaders }
}

/** Extract cookies and storage from browser and write to token cache */
export async function writeBrowserCookiesToCache(
  browser: Browser,
  site: string,
  spec: OpenApiSpec,
  baseDir?: string,
): Promise<void> {
  try {
    const context = browser.contexts()[0]
    if (!context) return

    const serverUrl = spec.servers?.[0]?.url
    if (!serverUrl) return

    const origin = new URL(serverUrl).hostname

    // Extract cookies
    const cookies = await context.cookies()
    const siteCookies = cookies
      .filter((c) => origin.endsWith(c.domain.replace(/^\./, '')) || c.domain.replace(/^\./, '').endsWith(origin))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
      }))

    // Extract localStorage/sessionStorage from the matching page
    let localStorage: Record<string, string> = {}
    let sessionStorage: Record<string, string> = {}
    const serverExt = getServerXOpenWeb(spec, Object.values(spec.paths ?? {})[0]?.get ?? Object.values(spec.paths ?? {})[0]?.post ?? {})
    const authType = serverExt?.auth?.type

    if (authType === 'localStorage_jwt' || authType === 'sessionStorage_msal') {
      const pages = context.pages()
      const page = pages.find((p) => {
        try { return new URL(p.url()).hostname.endsWith(origin) || origin.endsWith(new URL(p.url()).hostname) }
        catch { return false }
      })
      if (page) {
        try {
          localStorage = await page.evaluate(() => {
            const result: Record<string, string> = {}
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i)
              if (key) result[key] = window.localStorage.getItem(key) ?? ''
            }
            return result
          })
        } catch { /* page may be closed */ }
        try {
          sessionStorage = await page.evaluate(() => {
            const result: Record<string, string> = {}
            for (let i = 0; i < window.sessionStorage.length; i++) {
              const key = window.sessionStorage.key(i)
              if (key) result[key] = window.sessionStorage.getItem(key) ?? ''
            }
            return result
          })
        } catch { /* page may be closed */ }
      }
    }

    // Must have either cookies or storage to cache
    if (siteCookies.length === 0 && Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0) return

    // Derive TTL: use earliest cookie expiry or try to find JWT exp in cookie values
    let jwtExp: number | undefined
    let ttlSeconds = DEFAULT_TTL_SECONDS

    for (const c of siteCookies) {
      const exp = extractJwtExp(c.value)
      if (exp && (!jwtExp || exp < jwtExp)) {
        jwtExp = exp
      }
    }

    // Also check localStorage values for JWT exp
    if (!jwtExp) {
      for (const v of Object.values(localStorage)) {
        const exp = extractJwtExp(v)
        if (exp && (!jwtExp || exp < jwtExp)) {
          jwtExp = exp
        }
      }
    }

    // If no JWT found, use earliest finite cookie expiry to derive TTL
    if (!jwtExp) {
      const now = Date.now() / 1000
      for (const c of siteCookies) {
        if (typeof c.expires === 'number' && c.expires > now) {
          const remaining = Math.floor(c.expires - now)
          if (remaining < ttlSeconds) {
            ttlSeconds = remaining
          }
        }
      }
    }

    await writeTokenCache(site, {
      cookies: siteCookies,
      localStorage,
      sessionStorage,
      capturedAt: new Date().toISOString(),
      ttlSeconds,
      jwtExp,
    }, baseDir)
  } catch {
    // Cache write failure is not critical — continue silently
  }
}

/** Read cached tokens, with re-export for http-executor convenience */
export { readTokenCache, clearTokenCache, withTokenLock } from './token-cache.js'
