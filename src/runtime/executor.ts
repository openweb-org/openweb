import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import type { Browser } from 'playwright'
import Ajv from 'ajv'

import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { checkPermission, loadPermissions } from '../lib/permissions.js'
import { readTokenCache, writeTokenCache, clearTokenCache, DEFAULT_TTL_SECONDS, extractJwtExp, type CachedTokens } from './token-cache.js'
import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import {
  buildQueryUrl,
  findOperation,
  getRequestBodyParameters,
  getResponseSchema,
  getServerUrl,
  loadOpenApi,
  resolveSiteRoot,
  validateParams,
} from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
import { validateSSRF } from '../lib/ssrf.js'
import { fetchWithRedirects } from './redirect.js'
import { connectWithRetry } from '../capture/connection.js'
import {
  createNeedsPageError,
  executeSessionHttp,
  findPageForOrigin,
} from './session-executor.js'
import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import { buildHeaderParams, buildJsonRequestBody, resolveAllParameters, substitutePath } from './request-builder.js'
import { executeBrowserFetch } from './browser-fetch-executor.js'
import { loadAdapter, executeAdapter } from './adapter-executor.js'
import { executeExtraction } from './extraction-executor.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
import type { AdapterRef, PermissionCategory, XOpenWebOperation } from '../types/extensions.js'

export interface ExecuteDependencies {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
  /** CDP endpoint for session_http mode. If omitted, defaults to http://localhost:9222 */
  readonly cdpEndpoint?: string
  /** Pre-connected browser instance (used in tests to inject mocks) */
  readonly browser?: Browser
  /** Override permissions config (used in tests to bypass permission checks) */
  readonly permissionsConfig?: import('../lib/permissions.js').PermissionsConfig
  /** Override token cache directory (used in tests to isolate cache) */
  readonly tokenCacheDir?: string
}

export interface ExecuteResult {
  readonly status: number
  readonly body: unknown
  readonly responseSchemaValid: boolean
  readonly responseHeaders: Readonly<Record<string, string>>
}

export async function executeOperation(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  deps: ExecuteDependencies = {},
): Promise<ExecuteResult> {
  // Quarantine warning: emit to stderr but continue execution
  try {
    const siteRoot = await resolveSiteRoot(site)
    const manifest = await loadManifest(siteRoot)
    if (manifest?.quarantined) {
      process.stderr.write(`warning: site ${site} is quarantined — verification failed, results may be unreliable\n`)
    }
  } catch { /* manifest missing or unreadable — not an error */ }

  const spec = await loadOpenApi(site)
  const operationRef = findOperation(spec, operationId)
  const transport = resolveTransport(spec, operationRef.operation)

  // Permission gate: check before executing
  // Derive permission from x-openweb.permission or HTTP method (fail-closed)
  const opExt = operationRef.operation['x-openweb'] as XOpenWebOperation | undefined
  const category: PermissionCategory = opExt?.permission ?? derivePermissionFromMethod(operationRef.method, operationRef.path) as PermissionCategory
  const permConfig = deps.permissionsConfig ?? loadPermissions()
  const policy = checkPermission(permConfig, site, category)
  if (policy === 'deny') {
    throw OpenWebError.permissionDenied(site, operationId, category)
  }
  if (policy === 'prompt') {
    throw OpenWebError.permissionRequired(site, operationId, category)
  }

  let status: number
  let body: unknown
  let responseHeaders: Record<string, string> = {}

  // Check for L3 adapter — if present, adapter handles the entire operation
  const adapterRef = opExt?.adapter as AdapterRef | undefined
  if (adapterRef) {
    const siteRoot = await resolveSiteRoot(site)
    const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? 'http://localhost:9222')
    try {
      const adapter = await loadAdapter(siteRoot, adapterRef.name)
      const context = browser.contexts()[0]
      if (!context) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: 'No browser context available.',
          action: 'Open Chrome with --remote-debugging-port=9222.',
          retriable: true,
          failureClass: 'needs_browser',
        })
      }
      const serverUrl = operationRef.operation.servers?.[0]?.url ?? spec.servers?.[0]?.url ?? ''
      const page = await findPageForOrigin(context, serverUrl)
      if (!page) {
        throw createNeedsPageError(serverUrl)
      }
      const mergedParams = { ...params, ...adapterRef.params }

      // Validate params: required checks, unknown rejection, type validation, defaults
      const allParams = resolveAllParameters(spec, operationRef.operation)
      const adapterParams = validateParams(
        [...allParams, ...getRequestBodyParameters(operationRef.operation)],
        mergedParams,
      )

      body = await executeAdapter(page, adapter, adapterRef.operation, adapterParams)
      status = 200
    } finally {
      if (!deps.browser) {
        browser.close().catch(() => {})
      }
    }
  } else if (opExt?.extraction) {
    const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? 'http://localhost:9222')
    try {
      const result = await executeExtraction(browser, spec, operationRef.operation)
      status = result.status
      body = result.body
      responseHeaders = { ...result.responseHeaders }
    } finally {
      if (!deps.browser) {
        browser.close().catch(() => {})
      }
    }
  } else if (transport === 'page') {
    const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? 'http://localhost:9222')
    try {
      const result = await executeBrowserFetch(
        browser,
        spec,
        operationRef.path,
        operationRef.method,
        operationRef.operation,
        params,
        { fetchImpl: deps.fetchImpl, ssrfValidator: deps.ssrfValidator },
      )
      status = result.status
      body = result.body
      responseHeaders = { ...result.responseHeaders }
    } finally {
      if (!deps.browser) {
        browser.close().catch(() => {})
      }
    }
  } else if (transport === 'node') {
    // Check if server has auth/csrf/signing — if so, needs browser for cookie extraction
    const serverExt = getServerXOpenWeb(spec, operationRef.operation)
    const needsBrowser = !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)

    if (needsBrowser) {
      // Token cache: try cached cookies first (avoids browser connection)
      const cached = await readTokenCache(site, deps.tokenCacheDir)
      let cacheHit = false

      if (cached && (cached.cookies.length > 0 || Object.keys(cached.localStorage).length > 0)) {
        try {
          const result = await executeCachedFetch(spec, operationRef, serverExt, params, cached, deps)
          status = result.status
          body = result.body
          responseHeaders = result.responseHeaders
          cacheHit = true
        } catch (err) {
          // 401/403 means cache is stale — clear and fall through to browser
          if (err instanceof OpenWebError && err.payload.failureClass === 'needs_login') {
            await clearTokenCache(site, deps.tokenCacheDir)
          } else {
            throw err
          }
        }
      }

      if (!cacheHit) {
        const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? 'http://localhost:9222')
        try {
          const result = await executeSessionHttp(
            browser,
            spec,
            operationRef.path,
            operationRef.method,
            operationRef.operation,
            params,
            { fetchImpl: deps.fetchImpl, ssrfValidator: deps.ssrfValidator },
          )
          status = result.status
          body = result.body
          responseHeaders = { ...result.responseHeaders }

          // Write cookies to cache for future requests
          await writeBrowserCookiesToCache(browser, site, spec, deps.tokenCacheDir)
        } finally {
          if (!deps.browser) {
            browser.close().catch(() => {})
          }
        }
      }
    } else {
      const serverUrl = getServerUrl(spec, operationRef.operation)
      const allParams = resolveAllParameters(spec, operationRef.operation)
      const inputParams = validateParams(
        [...allParams, ...getRequestBodyParameters(operationRef.operation)],
        params,
      )
      const resolvedPath = substitutePath(operationRef.path, allParams, inputParams)
      const url = buildQueryUrl(serverUrl, resolvedPath, allParams, inputParams)
      const requestHeaders = buildHeaderParams(allParams, inputParams)
      const upperMethod = operationRef.method.toUpperCase()
      const jsonBody = upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH'
        ? buildJsonRequestBody(operationRef.operation, inputParams)
        : undefined
      if (jsonBody) {
        requestHeaders['Content-Type'] = 'application/json'
      }
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
          action: `Check parameters with: openweb ${site} ${operationId}`,
          retriable: httpFailure.retriable,
          failureClass: httpFailure.failureClass,
        })
      }

      status = response.status
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })
      const text = await response.text()
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
    }
  }

  const schema = getResponseSchema(operationRef.operation)
  let responseSchemaValid = true
  if (schema) {
    const ajv = new Ajv({ strict: false, allErrors: true })
    const validate = ajv.compile(schema)
    responseSchemaValid = validate(body)
    if (!responseSchemaValid) {
      process.stderr.write(
        `warning: response schema mismatch for ${site}/${operationId}: ${ajv.errorsText(validate.errors)}\n`,
      )
    }
  }

  return { status, body, responseSchemaValid, responseHeaders }
}

/** Execute a request using cached cookies instead of browser extraction */
async function executeCachedFetch(
  spec: import('../lib/openapi.js').OpenApiSpec,
  operationRef: { path: string; method: string; operation: import('../lib/openapi.js').OpenApiOperation },
  serverExt: import('../types/extensions.js').XOpenWebServer | undefined,
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
  const url = buildQueryUrl(serverUrl, resolvedPath, allParams, inputParams)
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
async function writeBrowserCookiesToCache(
  browser: import('playwright').Browser,
  site: string,
  spec: import('../lib/openapi.js').OpenApiSpec,
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

interface TestCase {
  readonly input: Record<string, unknown>
  readonly assertions: {
    readonly status: number
    readonly response_schema_valid: boolean
  }
}

interface TestFile {
  readonly operation_id: string
  readonly cases: TestCase[]
}

export async function runSiteTests(site: string): Promise<{ passed: number; failed: number }> {
  const siteRoot = await resolveSiteRoot(site)
  const testsDir = path.join(siteRoot, 'tests')

  let files: string[]
  try {
    files = await readdir(testsDir)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'TOOL_NOT_FOUND',
      message: `No tests found for site: ${site}`,
      action: 'Generate tests or use a site fixture that contains tests/*.test.json.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  let passed = 0
  let failed = 0

  for (const fileName of files) {
    if (!fileName.endsWith('.test.json')) {
      continue
    }

    const raw = await readFile(path.join(testsDir, fileName), 'utf8')
    const testFile = JSON.parse(raw) as TestFile

    for (const testCase of testFile.cases) {
      try {
        const result = await executeOperation(site, testFile.operation_id, testCase.input)
        const statusPass = result.status === testCase.assertions.status
        const schemaPass = result.responseSchemaValid === testCase.assertions.response_schema_valid

        if (statusPass && schemaPass) {
          passed += 1
        } else {
          failed += 1
          process.stderr.write(
            `FAIL ${testFile.operation_id} (${fileName}): expected status=${testCase.assertions.status}, schema=${testCase.assertions.response_schema_valid}; got status=${result.status}, schema=${result.responseSchemaValid}\n`,
          )
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`FAIL ${testFile.operation_id} (${fileName}): ${message}\n`)
      }
    }
  }

  return { passed, failed }
}
