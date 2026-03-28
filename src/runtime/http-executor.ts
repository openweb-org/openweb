import Ajv from 'ajv'
import type { Browser } from 'playwright-core'

import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { checkPermission, loadPermissions } from '../lib/permissions.js'
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
  autoNavigate,
} from './session-executor.js'
import { getServerXOpenWeb, resolveTransport } from './operation-context.js'
import { buildHeaderParams, buildJsonRequestBody, resolveAllParameters, substitutePath } from './request-builder.js'
import { executeBrowserFetch } from './browser-fetch-executor.js'
import { loadAdapter, executeAdapter } from './adapter-executor.js'
import { executeExtraction } from './extraction-executor.js'
import { executeNodeSsr } from './node-ssr-executor.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
import { executeCachedFetch, writeBrowserCookiesToCache, readTokenCache, clearTokenCache, withTokenLock, readTokenCacheUnsafe, clearTokenCacheUnsafe } from './cache-manager.js'
import { logger } from '../lib/logger.js'
import { CDP_ENDPOINT } from '../lib/config.js'
import type { AdapterRef, PermissionCategory, XOpenWebOperation } from '../types/extensions.js'

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
    const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? CDP_ENDPOINT)
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
      if (!page) {
        page = await autoNavigate(context, serverUrl)
      }
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
        browser.close().catch(() => {}) // intentional: cleanup — browser may already be closed
      }
    }
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
      const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? CDP_ENDPOINT)
      try {
        const result = await executeExtraction(browser, spec, operationRef.operation)
        status = result.status
        body = result.body
        responseHeaders = { ...result.responseHeaders }
      } finally {
        if (!deps.browser) {
          browser.close().catch(() => {}) // intentional: cleanup — browser may already be closed
        }
      }
    }
  } else if (transport === 'page') {
    const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? CDP_ENDPOINT)
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
        browser.close().catch(() => {}) // intentional: cleanup — browser may already be closed
      }
    }
  } else if (transport === 'node') {
    // Check if server has auth/csrf/signing — if so, needs browser for cookie extraction
    const serverExt = getServerXOpenWeb(spec, operationRef.operation)
    const needsBrowser = !!(serverExt?.auth || serverExt?.csrf || serverExt?.signing)

    if (needsBrowser) {
      // Token cache: serialize read→try→fallback→write per site to prevent race conditions
      const cacheResult = await withTokenLock(site, async () => {
        const cached = await readTokenCacheUnsafe(site, deps.tokenCacheDir)

        if (cached && (cached.cookies.length > 0 || Object.keys(cached.localStorage).length > 0)) {
          try {
            return await executeCachedFetch(spec, operationRef, serverExt, params, cached, deps)
          } catch (err) {
            // 401/403 means cache is stale — clear and fall through to browser
            if (err instanceof OpenWebError && err.payload.failureClass === 'needs_login') {
              await clearTokenCacheUnsafe(site, deps.tokenCacheDir)
            } else {
              throw err
            }
          }
        }
        return null
      })

      if (cacheResult) {
        status = cacheResult.status
        body = cacheResult.body
        responseHeaders = cacheResult.responseHeaders
      } else {
        const browser = deps.browser ?? await connectWithRetry(deps.cdpEndpoint ?? CDP_ENDPOINT)
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
            browser.close().catch(() => {}) // intentional: cleanup — browser may already be closed
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
          action: httpFailure.failureClass === 'needs_login'
            ? 'Run: openweb login <site>, then: openweb browser restart'
            : `Check parameters with: openweb ${site} ${operationId}`,
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

// ── Unified Protocol Dispatch ───────────────────────

const OPERATION_TIMEOUT = Number(process.env.OPENWEB_TIMEOUT) || 30_000

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

  const execute = entry.protocol === 'http'
    ? executeOperation(site, operationId, params, deps)
    : (await import('./ws-cli-executor.js')).executeWsFromCli(site, operationId, params, deps)

  return Promise.race([
    execute,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Operation ${operationId} timed out after ${OPERATION_TIMEOUT}ms`,
        action: 'Increase timeout via OPENWEB_TIMEOUT env variable (milliseconds).',
        retriable: true,
        failureClass: 'retriable',
      })), OPERATION_TIMEOUT),
    ),
  ])
}
