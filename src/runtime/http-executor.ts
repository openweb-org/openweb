import Ajv from 'ajv'
import type { Browser } from 'patchright'

import { DEFAULT_USER_AGENT, loadConfig } from '../lib/config.js'
import { shouldApplyCsrf } from '../lib/csrf-scope.js'
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { loadManifest } from '../lib/manifest.js'
import { validateParams } from '../lib/param-validator.js'
import { resolveSiteRoot } from '../lib/site-resolver.js'
import {
  findOperation,
  getRequestBodyParameters,
  getResponseSchema,
  getServerUrl,
  loadOpenApi,
} from '../lib/spec-loader.js'
import { buildQueryUrl } from '../lib/url-builder.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
import { checkPermission, loadPermissions } from '../lib/permissions.js'
import { parseResponseBody } from '../lib/response-parser.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { AdapterRef, PermissionCategory, XOpenWebOperation } from '../types/extensions.js'
import { executeAdapter, loadAdapter } from './adapter-executor.js'
import { type BrowserHandle, ensureBrowser, handleLoginRequired, refreshProfile } from './browser-lifecycle.js'
import { executeBrowserFetch } from './browser-fetch-executor.js'
import { clearTokenCache, executeCachedFetch, readTokenCache, writeBrowserCookiesToCache } from './cache-manager.js'
import { executeExtraction } from './extraction-executor.js'
import type { ExecutorResult } from './executor-result.js'
import { withHttpRetry } from './http-retry.js'
import { executeNodeSsr } from './node-ssr-executor.js'
import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import { fetchWithRedirects } from './redirect.js'
import { buildHeaderParams, buildJsonRequestBody, buildFormRequestBody, resolveAllParameters, substitutePath } from './request-builder.js'
import { applyResponseUnwrap } from './response-unwrap.js'
import {
  type AutoNavigateResult,
  autoNavigate,
  createNeedsPageError,
  executeSessionHttp,
  findPageForOrigin,
} from './session-executor.js'

/** Check if a URL points to localhost (127.0.0.1, localhost, or ::1). */
function isLocalhost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

export interface ExecuteDependencies {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
  /** CDP endpoint for session_http mode. If omitted, uses OPENWEB_CDP_PORT env or 9222 */
  readonly cdpEndpoint?: string
  /** Pre-connected browser instance (used in tests to inject mocks) */
  readonly browser?: Browser
  /** Override permissions config (used in tests to bypass permission checks) */
  readonly permissionsConfig?: import('../lib/permissions.js').PermissionsConfig
  /** Override token cache directory (used in tests to isolate cache) */
  readonly tokenCacheDir?: string
  /** Max WS messages for stream/subscribe (CLI only). Default: 1 */
  readonly wsCount?: number
  /** WS timeout in ms (CLI only). Default: TIMEOUT.ws */
  readonly wsTimeoutMs?: number
  /** Skip the login cascade (tiers 3+4) and re-throw needs_login immediately.
   *  Used by verify to avoid repeated login prompts for the same site. */
  readonly skipLoginCascade?: boolean
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
  let manifest: Awaited<ReturnType<typeof loadManifest>> | undefined
  try {
    const siteRoot = await resolveSiteRoot(site)
    manifest = await loadManifest(siteRoot)
    if (manifest?.quarantined) {
      process.stderr.write(`warning: site ${site} is quarantined — verification failed, results may be unreliable\n`)
    }
  } catch { /* intentional: manifest missing or unreadable — non-blocking check */ }

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

    // Shared: prepare params once (they don't change across retries)
    const mergedParams = { ...params, ...adapterRef.params }
    const allParams = resolveAllParameters(spec, operationRef.operation)
    const adapterParams = validateParams(
      [...allParams, ...getRequestBodyParameters(operationRef.operation)],
      mergedParams,
    )
    const serverExt = getServerXOpenWeb(spec, operationRef.operation)
    const requiresAuth = !!(serverExt?.auth) || !!manifest?.requires_auth

    /** Single adapter attempt: acquire browser → find/create page → execute */
    const adapterAttempt = async (): Promise<unknown> => {
      const handle = deps.browser ? undefined : await ensureBrowser(deps.cdpEndpoint)
      const browser = deps.browser ?? handle?.browser
      if (!browser) throw new Error('No browser available — ensureBrowser returned an invalid handle')
      try {
        const adapter = await loadAdapter(siteRoot, adapterRef.name)
        const context = browser.contexts()[0]
        if (!context) {
          throw new OpenWebError({
            error: 'execution_failed',
            code: 'EXECUTION_FAILED',
            message: 'No browser context available.',
            action: 'Run: openweb browser start',
            retriable: true,
            failureClass: 'needs_browser',
          })
        }
        const serverUrl = operationRef.operation.servers?.[0]?.url ?? spec.servers?.[0]?.url ?? ''
        let page = await findPageForOrigin(context, serverUrl)
        let ownedPage = false
        if (!page) {
          const nav = await autoNavigate(context, serverUrl)
          if (nav) { page = nav.page; ownedPage = nav.owned }
        }
        if (!page) {
          page = await context.newPage()
          ownedPage = true
        }
        try {
          return await executeAdapter(page, adapter, adapterRef.operation, adapterParams, { requiresAuth })
        } finally {
          if (ownedPage) await page.close().catch(() => {})
        }
      } finally {
        if (handle) await handle.release()
      }
    }

    try {
      body = await adapterAttempt()
    } catch (err) {
      if (!(err instanceof OpenWebError && err.payload.failureClass === 'needs_login')) throw err
      if (deps.skipLoginCascade) throw err

      if (deps.cdpEndpoint || deps.browser) {
        // External browser — skip profile refresh, try login cascade directly
        if (!deps.cdpEndpoint || isLocalhost(deps.cdpEndpoint)) {
          const loginUrl = manifest?.site_url ?? spec.servers?.[0]?.url ?? ''
          await handleLoginRequired(loginUrl, async () => {
            try { body = await adapterAttempt(); return true } catch (e) {
              if (e instanceof OpenWebError && e.payload.failureClass === 'needs_login') return false
              throw e
            }
          })
        } else {
          throw err
        }
      } else {
        // Managed browser: tier 3 (profile refresh) → tier 4 (user login)
        try {
          await refreshProfile()
          body = await adapterAttempt()
        } catch (err2) {
          if (!(err2 instanceof OpenWebError && err2.payload.failureClass === 'needs_login')) throw err2
          const loginUrl = manifest?.site_url ?? spec.servers?.[0]?.url ?? ''
          await handleLoginRequired(loginUrl, async () => {
            try { body = await adapterAttempt(); return true } catch (e) {
              if (e instanceof OpenWebError && e.payload.failureClass === 'needs_login') return false
              throw e
            }
          })
        }
      }
    }
    status = 200
  } else if (opExt?.extraction) {
    const extraction = opExt.extraction as import('../types/primitives.js').ExtractionPrimitive
    const serverExt = getServerXOpenWeb(spec, operationRef.operation)
    const needsBrowser = !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)

    if (!needsBrowser && transport === 'node' && extraction.type === 'ssr_next_data') {
      // Node-based SSR: fetch HTML page and parse __NEXT_DATA__ — no browser needed
      const serverUrl = getServerUrl(spec, operationRef.operation)
      const allParams = resolveAllParameters(spec, operationRef.operation)
      const inputParams = validateParams(
        [...allParams, ...getRequestBodyParameters(operationRef.operation)],
        params,
      )
      const resolvedPath = substitutePath(operationRef.path, allParams, inputParams)
      const url = buildQueryUrl(serverUrl, resolvedPath, allParams, inputParams)
      const result = await executeNodeSsr(url, extraction, {
        fetchImpl: deps.fetchImpl,
        ssrfValidator: deps.ssrfValidator,
      })
      status = result.status
      body = result.body
      responseHeaders = { ...result.responseHeaders }
    } else {
      const handle = deps.browser ? undefined : await ensureBrowser(deps.cdpEndpoint)
      const browser = deps.browser ?? handle?.browser
      if (!browser) throw new Error('No browser available — ensureBrowser returned an invalid handle')
      try {
        const result = await executeExtraction(browser, spec, operationRef.operation, operationRef.path, params)
        status = result.status
        body = result.body
        responseHeaders = { ...result.responseHeaders }
      } finally {
        if (handle) await handle.release()
      }
    }
  } else if (transport === 'page') {
    const handle = deps.browser ? undefined : await ensureBrowser(deps.cdpEndpoint)
    const browser = deps.browser ?? handle?.browser
    if (!browser) throw new Error('No browser available — ensureBrowser returned an invalid handle')
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
      if (handle) await handle.release()
    }
  } else if (transport === 'node') {
    // Check if server has auth/csrf/signing — if so, needs browser for cookie extraction
    const serverExt = getServerXOpenWeb(spec, operationRef.operation)
    const needsBrowser = !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)

    if (needsBrowser) {
      // ── 4-tier auth cascade ──────────────────────────
      // Lock is held only for brief cache reads/writes, never during browser ops.

      // Tier 1: Token cache — brief locked read, release immediately
      let cacheHit = false
      const cached = await readTokenCache(site, deps.tokenCacheDir)
      if (cached && (cached.cookies.length > 0 || Object.keys(cached.localStorage).length > 0)) {
        try {
          const cacheResult = await executeCachedFetch(spec, operationRef, serverExt, params, cached, deps)
          if (cacheResult) {
            status = cacheResult.status
            body = cacheResult.body
            responseHeaders = cacheResult.responseHeaders
            cacheHit = true
          }
        } catch (err) {
          if (!(err instanceof OpenWebError && err.payload.failureClass === 'needs_login')) throw err
          // 401/403 from cache — clear stale tokens, fall through to tier 2
          await clearTokenCache(site, deps.tokenCacheDir)
        }
      }

      if (!cacheHit) {
        // Helper: connect browser, execute, write cache on success
        const browserSessionExec = async (): Promise<{ result: ExecutorResult; handle: BrowserHandle | undefined; browser: Browser }> => {
          const handle = deps.browser ? undefined : await ensureBrowser(deps.cdpEndpoint)
          const browser = deps.browser ?? handle?.browser
      if (!browser) throw new Error('No browser available — ensureBrowser returned an invalid handle')
          try {
            const result = await executeSessionHttp(
              browser, spec, operationRef.path, operationRef.method,
              operationRef.operation, params,
              { fetchImpl: deps.fetchImpl, ssrfValidator: deps.ssrfValidator },
            )
            // Write cache (writeTokenCache inside writeBrowserCookiesToCache has its own lock)
            await writeBrowserCookiesToCache(browser, site, spec, deps.tokenCacheDir)
            return { result, handle, browser }
          } catch (err) {
            if (handle) await handle.release()
            throw err
          }
        }

        try {
          // Tier 2: Browser extract — ensureBrowser() → execute in browser context
          const { result, handle } = await browserSessionExec()
          if (handle) await handle.release()
          status = result.status
          body = result.body
          responseHeaders = { ...result.responseHeaders }
        } catch (err) {
          if (!(err instanceof OpenWebError && err.payload.failureClass === 'needs_login')) throw err
          if (deps.skipLoginCascade) throw err

          // External/pre-connected: skip tier 3 (can't restart their browser)
          // Tier 4: only if localhost
          if (deps.cdpEndpoint || deps.browser) {
            if (!deps.cdpEndpoint || isLocalhost(deps.cdpEndpoint)) {
              const loginUrl = manifest?.site_url ?? getServerUrl(spec, operationRef.operation)
              await handleLoginRequired(loginUrl, async () => {
                try {
                  const { result, handle } = await browserSessionExec()
                  if (handle) await handle.release()
                  status = result.status
                  body = result.body
                  responseHeaders = { ...result.responseHeaders }
                  return true
                } catch (retryErr) {
                  if (retryErr instanceof OpenWebError && retryErr.payload.failureClass === 'needs_login') return false
                  throw retryErr
                }
              })
            } else {
              throw err
            }
          } else {
            // Managed browser: full cascade (tiers 3 + 4)
            try {
              // Tier 3: Profile refresh — re-copy default Chrome profile, retry
              await refreshProfile()
              const { result, handle } = await browserSessionExec()
              if (handle) await handle.release()
              status = result.status
              body = result.body
              responseHeaders = { ...result.responseHeaders }
            } catch (err2) {
              if (!(err2 instanceof OpenWebError && err2.payload.failureClass === 'needs_login')) throw err2

              // Tier 4: User login — open system browser, poll with backoff
              // Use site_url from manifest (human login page), not API server URL
              const loginUrl = manifest?.site_url ?? getServerUrl(spec, operationRef.operation)
              await handleLoginRequired(loginUrl, async () => {
                try {
                  const { result, handle } = await browserSessionExec()
                  if (handle) await handle.release()
                  status = result.status
                  body = result.body
                  responseHeaders = { ...result.responseHeaders }
                  return true
                } catch (retryErr) {
                  if (retryErr instanceof OpenWebError && retryErr.payload.failureClass === 'needs_login') return false
                  throw retryErr
                }
              })
              // If handleLoginRequired returns without throwing, status is set
            }
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
      let requestBody: string | undefined
      if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
        const formBody = buildFormRequestBody(operationRef.operation, inputParams)
        if (formBody) {
          requestBody = formBody
          if (!requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
        } else {
          requestBody = buildJsonRequestBody(operationRef.operation, inputParams)
          if (requestBody && !requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json'
        }
      }
      const response = await fetchWithRedirects(url, upperMethod, { 'Accept': 'application/json', 'User-Agent': DEFAULT_USER_AGENT, ...requestHeaders }, requestBody, {
        fetchImpl: deps.fetchImpl ?? fetch,
        ssrfValidator: deps.ssrfValidator ?? validateSSRF,
      })

      if (!response.ok) {
        const httpFailure = getHttpFailure(response.status)
        throw new OpenWebError({
          error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
          code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
          message: `HTTP ${response.status}`,
          action: httpFailure.failureClass === 'needs_login'
            ? 'Run: openweb login <site>, then: openweb browser restart'
            : `Check parameters with: openweb ${site} ${operationId}`,
          retriable: httpFailure.retriable,
          failureClass: httpFailure.failureClass,
          retryAfter: response.headers.get('retry-after') ?? undefined,
        })
      }

      status = response.status
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })
      const text = await response.text()
      body = parseResponseBody(text, response.headers.get('content-type'), response.status)
      body = applyResponseUnwrap(body, operationRef.operation)
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

// ── Unified Protocol Dispatch ───────────────────────

const OPERATION_TIMEOUT = loadConfig().timeout ?? 30_000

/**
 * Route an operation to the correct executor based on protocol.
 * HTTP operations go through the existing executeOperation path.
 * WS operations are detected and dispatched separately.
 */
export async function dispatchOperation(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  deps: ExecuteDependencies = {},
): Promise<ExecuteResult> {
  const { loadSitePackage, findOperationEntry } = await import('../lib/site-package.js')
  const pkg = await loadSitePackage(site)
  const entry = findOperationEntry(pkg, operationId)

  // AbortController to cancel underlying work (fetch, browser ops) on timeout
  const controller = new AbortController()
  const { signal } = controller

  // Wrap fetchImpl so every underlying fetch call receives the abort signal.
  // This covers node-fetch, redirect chains, session-executor, cache-manager, etc.
  const baseFetch = deps.fetchImpl ?? fetch
  const abortableFetch: typeof fetch = (input, init) =>
    baseFetch(input, { ...init, signal: init?.signal ?? signal })
  const abortableDeps: ExecuteDependencies = { ...deps, fetchImpl: abortableFetch }

  const execute = entry.protocol === 'http'
    ? withHttpRetry(() => executeOperation(site, operationId, params, abortableDeps), site)
    : (await import('./ws-cli-executor.js')).executeWsFromCli(site, operationId, params, abortableDeps)

  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    execute,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Operation ${operationId} timed out after ${OPERATION_TIMEOUT}ms`,
          action: 'Increase timeout in $OPENWEB_HOME/config.json (milliseconds).',
          retriable: true,
          failureClass: 'retriable',
        }))
      }, OPERATION_TIMEOUT)
    }),
  ]).finally(() => clearTimeout(timer))
}
