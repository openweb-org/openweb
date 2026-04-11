import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Browser, BrowserContext, Page } from 'patchright'
import { OpenWebError } from '../lib/errors.js'
import type { PermissionsConfig } from '../lib/permissions.js'
import type { OpenApiOperation, OpenApiSpec, OperationRef } from '../lib/spec-loader.js'
import type { ExecutorResult } from './executor-result.js'

// ── Mocks ────────────────────────────────────────

// Mock config (must precede imports that call loadConfig at module level)
vi.mock('../lib/config.js', () => ({
  loadConfig: () => ({ timeout: 500 }),
  DEFAULT_USER_AGENT: 'openweb-test/1.0',
  openwebHome: () => '/tmp/openweb-test',
}))

// Mock openapi helpers (split across source modules)
const mockLoadOpenApi = vi.fn<() => Promise<OpenApiSpec>>()
const mockFindOperation = vi.fn<() => OperationRef>()
const mockGetServerUrl = vi.fn<() => string>()
const mockGetResponseSchema = vi.fn<() => unknown>()
const mockGetRequestBodyParameters = vi.fn<() => unknown[]>()
vi.mock('../lib/spec-loader.js', () => ({
  loadOpenApi: (...a: unknown[]) => mockLoadOpenApi(...a),
  findOperation: (...a: unknown[]) => mockFindOperation(...a),
  getServerUrl: (...a: unknown[]) => mockGetServerUrl(...a),
  getResponseSchema: (...a: unknown[]) => mockGetResponseSchema(...a),
  getRequestBodyParameters: (...a: unknown[]) => mockGetRequestBodyParameters(...a),
}))

const mockValidateParams = vi.fn<(params: unknown[], input: Record<string, unknown>) => Record<string, unknown>>()
vi.mock('../lib/param-validator.js', () => ({
  validateParams: (...a: unknown[]) => mockValidateParams(...a),
}))

const mockResolveSiteRoot = vi.fn<() => Promise<string>>()
vi.mock('../lib/site-resolver.js', () => ({
  resolveSiteRoot: (...a: unknown[]) => mockResolveSiteRoot(...a),
}))

const mockBuildQueryUrl = vi.fn<() => string>()
vi.mock('../lib/url-builder.js', () => ({
  buildQueryUrl: (...a: unknown[]) => mockBuildQueryUrl(...a),
}))

// Mock manifest
const mockLoadManifest = vi.fn<() => Promise<{ quarantined?: boolean; requires_auth?: boolean; site_url?: string } | undefined>>()
vi.mock('../lib/manifest.js', () => ({
  loadManifest: (...a: unknown[]) => mockLoadManifest(...a),
}))

// Mock permissions
const mockCheckPermission = vi.fn<() => 'allow' | 'deny' | 'prompt'>()
const mockLoadPermissions = vi.fn<() => PermissionsConfig>()
vi.mock('../lib/permissions.js', () => ({
  checkPermission: (...a: unknown[]) => mockCheckPermission(...a),
  loadPermissions: (...a: unknown[]) => mockLoadPermissions(...a),
}))

// Mock permission-derive
vi.mock('../lib/permission-derive.js', () => ({
  derivePermissionFromMethod: () => 'read',
}))

// Mock csrf-scope
vi.mock('../lib/csrf-scope.js', () => ({
  shouldApplyCsrf: () => false,
}))

// Mock ssrf
vi.mock('../lib/ssrf.js', () => ({
  validateSSRF: async () => {},
}))

// Mock response-parser
vi.mock('../lib/response-parser.js', () => ({
  parseResponseBody: (text: string) => {
    try { return JSON.parse(text) } catch { return text }
  },
}))

// Mock logger
vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock operation-context
const mockResolveTransport = vi.fn<() => 'node' | 'page'>()
const mockGetServerXOpenWeb = vi.fn<() => unknown>()
vi.mock('./operation-context.js', () => ({
  resolveTransport: (...a: unknown[]) => mockResolveTransport(...a),
  getServerXOpenWeb: (...a: unknown[]) => mockGetServerXOpenWeb(...a),
}))

// Mock browser-lifecycle
const mockEnsureBrowser = vi.fn<() => Promise<{ browser: Browser; release: () => Promise<void> }>>()
const mockHandleLoginRequired = vi.fn<() => Promise<void>>()
const mockRefreshProfile = vi.fn<() => Promise<void>>()
vi.mock('./browser-lifecycle.js', () => ({
  ensureBrowser: (...a: unknown[]) => mockEnsureBrowser(...a),
  handleLoginRequired: (...a: unknown[]) => mockHandleLoginRequired(...a),
  refreshProfile: (...a: unknown[]) => mockRefreshProfile(...a),
}))

// Mock browser-fetch-executor
const mockExecuteBrowserFetch = vi.fn<() => Promise<ExecutorResult>>()
vi.mock('./browser-fetch-executor.js', () => ({
  executeBrowserFetch: (...a: unknown[]) => mockExecuteBrowserFetch(...a),
}))

// Mock node-ssr-executor
const mockExecuteNodeSsr = vi.fn<() => Promise<ExecutorResult>>()
vi.mock('./node-ssr-executor.js', () => ({
  executeNodeSsr: (...a: unknown[]) => mockExecuteNodeSsr(...a),
}))

// Mock extraction-executor
const mockExecuteExtraction = vi.fn<() => Promise<ExecutorResult>>()
vi.mock('./extraction-executor.js', () => ({
  executeExtraction: (...a: unknown[]) => mockExecuteExtraction(...a),
}))

// Mock session-executor
const mockExecuteSessionHttp = vi.fn<() => Promise<ExecutorResult>>()
const mockAutoNavigate = vi.fn<() => Promise<{ page: Page; owned: boolean } | null>>()
const mockFindPageForOrigin = vi.fn<() => Promise<Page | null>>()
vi.mock('./session-executor.js', () => ({
  executeSessionHttp: (...a: unknown[]) => mockExecuteSessionHttp(...a),
  autoNavigate: (...a: unknown[]) => mockAutoNavigate(...a),
  findPageForOrigin: (...a: unknown[]) => mockFindPageForOrigin(...a),
  createNeedsPageError: () => OpenWebError.needsPage('https://example.com'),
}))

// Mock adapter-executor
const mockExecuteAdapter = vi.fn<() => Promise<unknown>>()
const mockLoadAdapter = vi.fn<() => Promise<unknown>>()
vi.mock('./adapter-executor.js', () => ({
  executeAdapter: (...a: unknown[]) => mockExecuteAdapter(...a),
  loadAdapter: (...a: unknown[]) => mockLoadAdapter(...a),
}))

// Mock cache-manager
const mockReadTokenCache = vi.fn<() => Promise<{ cookies: unknown[]; localStorage: Record<string, string> } | null>>()
const mockExecuteCachedFetch = vi.fn<() => Promise<ExecutorResult | null>>()
const mockWriteBrowserCookiesToCache = vi.fn<() => Promise<void>>()
const mockClearTokenCache = vi.fn<() => Promise<void>>()
vi.mock('./cache-manager.js', () => ({
  readTokenCache: (...a: unknown[]) => mockReadTokenCache(...a),
  executeCachedFetch: (...a: unknown[]) => mockExecuteCachedFetch(...a),
  writeBrowserCookiesToCache: (...a: unknown[]) => mockWriteBrowserCookiesToCache(...a),
  clearTokenCache: (...a: unknown[]) => mockClearTokenCache(...a),
}))

// Mock redirect
const mockFetchWithRedirects = vi.fn<() => Promise<Response>>()
vi.mock('./redirect.js', () => ({
  fetchWithRedirects: (...a: unknown[]) => mockFetchWithRedirects(...a),
}))

// Mock request-builder
const mockResolveAllParameters = vi.fn<() => unknown[]>()
const mockSubstitutePath = vi.fn<() => string>()
const mockBuildHeaderParams = vi.fn<() => Record<string, string>>()
const mockBuildJsonRequestBody = vi.fn<() => string | undefined>()
const mockBuildFormRequestBody = vi.fn<() => string | undefined>()
vi.mock('./request-builder.js', () => ({
  resolveAllParameters: (...a: unknown[]) => mockResolveAllParameters(...a),
  substitutePath: (...a: unknown[]) => mockSubstitutePath(...a),
  buildHeaderParams: (...a: unknown[]) => mockBuildHeaderParams(...a),
  buildJsonRequestBody: (...a: unknown[]) => mockBuildJsonRequestBody(...a),
  buildFormRequestBody: (...a: unknown[]) => mockBuildFormRequestBody(...a),
}))

// Mock response-unwrap
vi.mock('./response-unwrap.js', () => ({
  applyResponseUnwrap: (body: unknown) => body,
}))

// Mock http-retry (pass-through, no retry logic in unit test)
vi.mock('./http-retry.js', () => ({
  withHttpRetry: (fn: () => Promise<unknown>) => fn(),
}))

// Mock site-package (used by dispatchOperation)
const mockLoadSitePackage = vi.fn()
const mockFindOperationEntry = vi.fn()
vi.mock('../lib/site-package.js', () => ({
  loadSitePackage: (...a: unknown[]) => mockLoadSitePackage(...a),
  findOperationEntry: (...a: unknown[]) => mockFindOperationEntry(...a),
}))

// Mock ws-cli-executor (used by dispatchOperation for ws protocol)
const mockExecuteWsFromCli = vi.fn()
vi.mock('./ws-cli-executor.js', () => ({
  executeWsFromCli: (...a: unknown[]) => mockExecuteWsFromCli(...a),
}))

// Suppress stderr writes (quarantine warnings, schema mismatch)
vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

// ── Imports (after mocks) ────────────────────────

import { executeOperation, dispatchOperation } from './http-executor.js'

// ── Helpers ──────────────────────────────────────

function makeSpec(overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
  return {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0' },
    servers: [{ url: 'https://api.example.com' }],
    ...overrides,
  }
}

function makeOperationRef(opOverrides: Partial<OpenApiOperation> = {}, method = 'get' as const, path = '/test'): OperationRef {
  return {
    method,
    path,
    operation: {
      operationId: 'testOp',
      ...opOverrides,
    } as OpenApiOperation,
  }
}

function makeFakeBrowser(contextOverrides: Partial<BrowserContext> = {}): Browser {
  const fakePage = { close: vi.fn().mockResolvedValue(undefined), url: () => 'https://api.example.com' } as unknown as Page
  return {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    contexts: () => [{
      newPage: vi.fn().mockResolvedValue(fakePage),
      pages: () => [fakePage],
      ...contextOverrides,
    }] as unknown as BrowserContext[],
  } as unknown as Browser
}

function makeBrowserHandle(browser?: Browser) {
  return {
    browser: browser ?? makeFakeBrowser(),
    release: vi.fn().mockResolvedValue(undefined),
  }
}

/** Set up standard mocks for a simple node-transport, no-auth operation */
function setupNodeNoAuth(spec?: OpenApiSpec, opRef?: OperationRef) {
  const s = spec ?? makeSpec()
  const o = opRef ?? makeOperationRef()
  mockLoadOpenApi.mockResolvedValue(s)
  mockFindOperation.mockReturnValue(o)
  mockResolveTransport.mockReturnValue('node')
  mockGetServerXOpenWeb.mockReturnValue(undefined)
  mockCheckPermission.mockReturnValue('allow')
  mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
  mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
  mockLoadManifest.mockResolvedValue(undefined)
  mockGetResponseSchema.mockReturnValue(undefined)
  mockResolveAllParameters.mockReturnValue([])
  mockValidateParams.mockImplementation((_p, input) => input as Record<string, unknown>)
  mockGetRequestBodyParameters.mockReturnValue([])
  mockSubstitutePath.mockReturnValue('/test')
  mockBuildQueryUrl.mockReturnValue('https://api.example.com/test')
  mockBuildHeaderParams.mockReturnValue({})
  mockBuildJsonRequestBody.mockReturnValue(undefined)
  mockGetServerUrl.mockReturnValue('https://api.example.com')
}

// ── Tests ────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Transport Selection ──────────────────────────

describe('executeOperation — transport selection', () => {
  it('dispatches to fetchWithRedirects for node transport without auth', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(mockFetchWithRedirects).toHaveBeenCalledTimes(1)
    expect(mockExecuteBrowserFetch).not.toHaveBeenCalled()
    expect(mockExecuteSessionHttp).not.toHaveBeenCalled()
  })

  it('dispatches to executeBrowserFetch for page transport', async () => {
    const spec = makeSpec()
    const opRef = makeOperationRef()
    mockLoadOpenApi.mockResolvedValue(spec)
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('page')
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteBrowserFetch.mockResolvedValue({ status: 200, body: { page: true }, responseHeaders: {} })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ page: true })
    expect(mockExecuteBrowserFetch).toHaveBeenCalledTimes(1)
    expect(mockFetchWithRedirects).not.toHaveBeenCalled()
    expect(handle.release).toHaveBeenCalled()
  })

  it('dispatches to executeSessionHttp for node transport with auth', async () => {
    const spec = makeSpec()
    const opRef = makeOperationRef()
    mockLoadOpenApi.mockResolvedValue(spec)
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('node')
    mockGetServerXOpenWeb.mockReturnValue({ auth: { type: 'cookie' } })
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockResolvedValue({ status: 200, body: { auth: true }, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ auth: true })
    expect(mockExecuteSessionHttp).toHaveBeenCalledTimes(1)
    expect(mockFetchWithRedirects).not.toHaveBeenCalled()
    expect(handle.release).toHaveBeenCalled()
  })

  it('dispatches to executeExtraction when x-openweb.extraction is set (browser path)', async () => {
    const opRef = makeOperationRef({ 'x-openweb': { extraction: { type: 'script_json' } } } as Record<string, unknown>)
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('node')
    mockGetServerXOpenWeb.mockReturnValue({ auth: { type: 'cookie' } })
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteExtraction.mockResolvedValue({ status: 200, body: { extracted: true }, responseHeaders: {} })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ extracted: true })
    expect(mockExecuteExtraction).toHaveBeenCalledTimes(1)
    expect(handle.release).toHaveBeenCalled()
  })

  it('dispatches to executeNodeSsr for ssr_next_data extraction without auth on node transport', async () => {
    const opRef = makeOperationRef({ 'x-openweb': { extraction: { type: 'ssr_next_data', path: 'props' } } } as Record<string, unknown>)
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('node')
    mockGetServerXOpenWeb.mockReturnValue(undefined)
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)
    mockResolveAllParameters.mockReturnValue([])
    mockValidateParams.mockImplementation((_p, input) => input as Record<string, unknown>)
    mockGetRequestBodyParameters.mockReturnValue([])
    mockSubstitutePath.mockReturnValue('/test')
    mockBuildQueryUrl.mockReturnValue('https://api.example.com/test')
    mockGetServerUrl.mockReturnValue('https://api.example.com')
    mockExecuteNodeSsr.mockResolvedValue({ status: 200, body: { ssr: true }, responseHeaders: {} })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ssr: true })
    expect(mockExecuteNodeSsr).toHaveBeenCalledTimes(1)
    expect(mockEnsureBrowser).not.toHaveBeenCalled()
  })

  it('dispatches to executeAdapter when x-openweb.adapter is set', async () => {
    const opRef = makeOperationRef({ 'x-openweb': { adapter: { name: 'test-adapter', operation: 'doThing', params: {} } } } as Record<string, unknown>)
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('node')
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)
    mockResolveAllParameters.mockReturnValue([])
    mockValidateParams.mockImplementation((_p, input) => input as Record<string, unknown>)
    mockGetRequestBodyParameters.mockReturnValue([])
    mockGetServerXOpenWeb.mockReturnValue(undefined)

    const browser = makeFakeBrowser()
    const handle = makeBrowserHandle(browser)
    mockEnsureBrowser.mockResolvedValue(handle)
    mockLoadAdapter.mockResolvedValue({ execute: vi.fn() })
    mockFindPageForOrigin.mockResolvedValue(null)
    mockAutoNavigate.mockResolvedValue(null)
    mockExecuteAdapter.mockResolvedValue({ result: 'adapted' })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ result: 'adapted' })
    expect(mockLoadAdapter).toHaveBeenCalledTimes(1)
    expect(mockExecuteAdapter).toHaveBeenCalledTimes(1)
  })

  it('uses injected browser from deps instead of calling ensureBrowser', async () => {
    const spec = makeSpec()
    const opRef = makeOperationRef()
    mockLoadOpenApi.mockResolvedValue(spec)
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('page')
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)

    const injectedBrowser = makeFakeBrowser()
    mockExecuteBrowserFetch.mockResolvedValue({ status: 200, body: {}, responseHeaders: {} })

    await executeOperation('test-site', 'testOp', {}, { browser: injectedBrowser })

    expect(mockEnsureBrowser).not.toHaveBeenCalled()
    expect(mockExecuteBrowserFetch).toHaveBeenCalledWith(
      injectedBrowser, expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
  })
})

// ── Permission Gate ──────────────────────────────

describe('executeOperation — permission gate', () => {
  it('throws permission_denied when policy is deny', async () => {
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(makeOperationRef())
    mockResolveTransport.mockReturnValue('node')
    mockCheckPermission.mockReturnValue('deny')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'deny', delete: 'deny', transact: 'deny' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toMatchObject({
      payload: { failureClass: 'permission_denied' },
    })
  })

  it('throws permission_required when policy is prompt', async () => {
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(makeOperationRef())
    mockResolveTransport.mockReturnValue('node')
    mockCheckPermission.mockReturnValue('prompt')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'prompt', delete: 'prompt', transact: 'deny' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toMatchObject({
      payload: { failureClass: 'permission_required' },
    })
  })

  it('uses deps.permissionsConfig override when provided', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const customPerms: PermissionsConfig = {
      defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' },
    }
    await executeOperation('test-site', 'testOp', {}, { permissionsConfig: customPerms })

    expect(mockCheckPermission).toHaveBeenCalledWith(customPerms, 'test-site', 'read')
  })
})

// ── Error Handling ───────────────────────────────

describe('executeOperation — error handling', () => {
  it('throws OpenWebError for non-2xx HTTP responses on node transport', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response('Server Error', { status: 503, headers: { 'content-type': 'text/plain' } }),
    )

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toMatchObject({
      payload: {
        failureClass: 'retriable',
        message: 'HTTP 503',
      },
    })
  })

  it('throws needs_login for 401 response', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }),
    )

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toMatchObject({
      payload: {
        failureClass: 'needs_login',
        code: 'AUTH_FAILED',
      },
    })
  })

  it('throws needs_login for 403 response', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }),
    )

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toMatchObject({
      payload: {
        failureClass: 'needs_login',
      },
    })
  })

  it('includes retry-after header in error payload when present', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response('Too Many Requests', {
        status: 429,
        headers: { 'content-type': 'text/plain', 'retry-after': '60' },
      }),
    )

    try {
      await executeOperation('test-site', 'testOp', {})
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OpenWebError)
      expect((err as OpenWebError).payload.retryAfter).toBe('60')
    }
  })

  it('releases browser handle when page transport throws', async () => {
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(makeOperationRef())
    mockResolveTransport.mockReturnValue('page')
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteBrowserFetch.mockRejectedValue(new Error('browser crashed'))

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toThrow('browser crashed')
    expect(handle.release).toHaveBeenCalled()
  })

  it('releases browser handle when extraction throws', async () => {
    const opRef = makeOperationRef({ 'x-openweb': { extraction: { type: 'script_json' } } } as Record<string, unknown>)
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(opRef)
    mockResolveTransport.mockReturnValue('node')
    mockGetServerXOpenWeb.mockReturnValue({ auth: { type: 'cookie' } })
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteExtraction.mockRejectedValue(new Error('extraction failed'))

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toThrow('extraction failed')
    expect(handle.release).toHaveBeenCalled()
  })
})

// ── Response Schema Validation ───────────────────

describe('executeOperation — response schema validation', () => {
  it('sets responseSchemaValid=true when no schema is defined', async () => {
    setupNodeNoAuth()
    mockGetResponseSchema.mockReturnValue(undefined)
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ data: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await executeOperation('test-site', 'testOp', {})
    expect(result.responseSchemaValid).toBe(true)
  })

  it('sets responseSchemaValid=true when response matches schema', async () => {
    setupNodeNoAuth()
    mockGetResponseSchema.mockReturnValue({ type: 'object', properties: { name: { type: 'string' } } })
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ name: 'test' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await executeOperation('test-site', 'testOp', {})
    expect(result.responseSchemaValid).toBe(true)
  })

  it('sets responseSchemaValid=false when response violates schema', async () => {
    setupNodeNoAuth()
    mockGetResponseSchema.mockReturnValue({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } })
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ wrong: 123 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await executeOperation('test-site', 'testOp', {})
    expect(result.responseSchemaValid).toBe(false)
  })
})

// ── 4-Tier Auth Cascade ──────────────────────────

describe('executeOperation — 4-tier auth cascade', () => {
  function setupAuthNode() {
    mockLoadOpenApi.mockResolvedValue(makeSpec())
    mockFindOperation.mockReturnValue(makeOperationRef())
    mockResolveTransport.mockReturnValue('node')
    mockGetServerXOpenWeb.mockReturnValue({ auth: { type: 'cookie' } })
    mockCheckPermission.mockReturnValue('allow')
    mockLoadPermissions.mockReturnValue({ defaults: { read: 'allow', write: 'allow', delete: 'allow', transact: 'allow' } })
    mockResolveSiteRoot.mockResolvedValue('/tmp/sites/test')
    mockLoadManifest.mockResolvedValue(undefined)
    mockGetResponseSchema.mockReturnValue(undefined)
    mockGetServerUrl.mockReturnValue('https://api.example.com')
  }

  it('tier 1: uses cached tokens when cache hit is successful', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue({ cookies: [{ name: 'sid', value: 'abc' }], localStorage: {} })
    mockExecuteCachedFetch.mockResolvedValue({ status: 200, body: { cached: true }, responseHeaders: {} })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ cached: true })
    expect(mockEnsureBrowser).not.toHaveBeenCalled()
    expect(mockExecuteSessionHttp).not.toHaveBeenCalled()
  })

  it('tier 1: skips cache when no cached tokens exist', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockResolvedValue({ status: 200, body: { fresh: true }, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ fresh: true })
    expect(mockExecuteSessionHttp).toHaveBeenCalledTimes(1)
  })

  it('tier 1: skips cache when cache has empty cookies and localStorage', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue({ cookies: [], localStorage: {} })

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockResolvedValue({ status: 200, body: { data: 1 }, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    const result = await executeOperation('test-site', 'testOp', {})
    expect(mockExecuteSessionHttp).toHaveBeenCalledTimes(1)
    expect(result.body).toEqual({ data: 1 })
  })

  it('tier 1 → tier 2: falls through to browser when cached fetch returns needs_login', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue({ cookies: [{ name: 'sid', value: 'stale' }], localStorage: {} })
    mockExecuteCachedFetch.mockRejectedValue(OpenWebError.needsLogin())
    mockClearTokenCache.mockResolvedValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockResolvedValue({ status: 200, body: { tier2: true }, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    const result = await executeOperation('test-site', 'testOp', {})

    expect(mockClearTokenCache).toHaveBeenCalledTimes(1)
    expect(result.body).toEqual({ tier2: true })
  })

  it('tier 2: writes cookies to cache after successful browser session', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockResolvedValue({ status: 200, body: {}, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    await executeOperation('test-site', 'testOp', {})

    expect(mockWriteBrowserCookiesToCache).toHaveBeenCalledTimes(1)
  })

  it('tier 2 → tier 3 → tier 4: full cascade on needs_login (managed browser)', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)
    mockRefreshProfile.mockResolvedValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)

    // Tier 2 fails with needs_login
    // Tier 3 (refreshProfile) also fails with needs_login
    // Tier 4 (handleLoginRequired) succeeds
    mockExecuteSessionHttp
      .mockRejectedValueOnce(OpenWebError.needsLogin())    // tier 2
      .mockRejectedValueOnce(OpenWebError.needsLogin())    // tier 3 retry
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    // handleLoginRequired calls the retryFn which should succeed
    mockHandleLoginRequired.mockImplementation(async (_url, retryFn) => {
      // Simulate successful retry inside login handler
      mockExecuteSessionHttp.mockResolvedValueOnce({ status: 200, body: { tier4: true }, responseHeaders: {} })
      await retryFn()
    })

    const result = await executeOperation('test-site', 'testOp', {})

    expect(mockRefreshProfile).toHaveBeenCalledTimes(1)
    expect(mockHandleLoginRequired).toHaveBeenCalledTimes(1)
    expect(result.body).toEqual({ tier4: true })
  })

  it('tier 2 → tier 3: succeeds after profile refresh without reaching tier 4', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)
    mockRefreshProfile.mockResolvedValue(undefined)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)

    // Tier 2 fails, tier 3 succeeds
    mockExecuteSessionHttp
      .mockRejectedValueOnce(OpenWebError.needsLogin())
      .mockResolvedValueOnce({ status: 200, body: { tier3: true }, responseHeaders: {} })
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    const result = await executeOperation('test-site', 'testOp', {})

    expect(mockRefreshProfile).toHaveBeenCalledTimes(1)
    expect(mockHandleLoginRequired).not.toHaveBeenCalled()
    expect(result.body).toEqual({ tier3: true })
  })

  it('re-throws needs_login immediately when skipLoginCascade is true', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockRejectedValue(OpenWebError.needsLogin())

    await expect(
      executeOperation('test-site', 'testOp', {}, { skipLoginCascade: true }),
    ).rejects.toMatchObject({
      payload: { failureClass: 'needs_login' },
    })

    expect(mockRefreshProfile).not.toHaveBeenCalled()
    expect(mockHandleLoginRequired).not.toHaveBeenCalled()
  })

  it('re-throws non-needs_login errors without cascade', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockRejectedValue(new Error('network failure'))

    await expect(executeOperation('test-site', 'testOp', {})).rejects.toThrow('network failure')
    expect(mockRefreshProfile).not.toHaveBeenCalled()
  })

  it('skips tier 3 (profile refresh) for external browser (cdpEndpoint)', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockRejectedValue(OpenWebError.needsLogin())
    mockWriteBrowserCookiesToCache.mockResolvedValue(undefined)

    // handleLoginRequired should be called directly (skip tier 3)
    mockHandleLoginRequired.mockImplementation(async (_url, retryFn) => {
      mockExecuteSessionHttp.mockResolvedValueOnce({ status: 200, body: { external: true }, responseHeaders: {} })
      await retryFn()
    })

    const result = await executeOperation('test-site', 'testOp', {}, { cdpEndpoint: 'http://localhost:9222' })

    expect(mockRefreshProfile).not.toHaveBeenCalled()
    expect(mockHandleLoginRequired).toHaveBeenCalledTimes(1)
    expect(result.body).toEqual({ external: true })
  })

  it('re-throws needs_login for remote (non-localhost) cdpEndpoint', async () => {
    setupAuthNode()
    mockReadTokenCache.mockResolvedValue(null)

    const handle = makeBrowserHandle()
    mockEnsureBrowser.mockResolvedValue(handle)
    mockExecuteSessionHttp.mockRejectedValue(OpenWebError.needsLogin())

    await expect(
      executeOperation('test-site', 'testOp', {}, { cdpEndpoint: 'http://remote-host:9222' }),
    ).rejects.toMatchObject({
      payload: { failureClass: 'needs_login' },
    })

    expect(mockRefreshProfile).not.toHaveBeenCalled()
    expect(mockHandleLoginRequired).not.toHaveBeenCalled()
  })
})

// ── Node Transport Request Building ──────────────

describe('executeOperation — node transport request building', () => {
  it('sets Content-Type to application/json for POST with JSON body', async () => {
    setupNodeNoAuth()
    const opRef = makeOperationRef({}, 'post' as const, '/items')
    mockFindOperation.mockReturnValue(opRef)
    mockBuildJsonRequestBody.mockReturnValue('{"name":"test"}')
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ created: true }), { status: 201, headers: { 'content-type': 'application/json' } }),
    )

    await executeOperation('test-site', 'testOp', { name: 'test' })

    const callArgs = mockFetchWithRedirects.mock.calls[0]
    const headers = callArgs![2] as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('does not set Content-Type for GET requests', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await executeOperation('test-site', 'testOp', {})

    const callArgs = mockFetchWithRedirects.mock.calls[0]
    const headers = callArgs![2] as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('preserves response headers from fetch response', async () => {
    setupNodeNoAuth()
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'value' },
      }),
    )

    const result = await executeOperation('test-site', 'testOp', {})
    expect(result.responseHeaders['x-custom']).toBe('value')
  })
})

// ── Quarantine Warning ───────────────────────────

describe('executeOperation — quarantine', () => {
  it('emits quarantine warning to stderr but still executes', async () => {
    setupNodeNoAuth()
    mockLoadManifest.mockResolvedValue({ quarantined: true })
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await executeOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('quarantined'),
    )
  })

  it('continues execution when manifest fails to load', async () => {
    setupNodeNoAuth()
    mockLoadManifest.mockRejectedValue(new Error('file not found'))
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await executeOperation('test-site', 'testOp', {})
    expect(result.status).toBe(200)
  })
})

// ── dispatchOperation ────────────────────────────

describe('dispatchOperation', () => {
  it('routes HTTP operations through executeOperation', async () => {
    setupNodeNoAuth()
    mockLoadSitePackage.mockResolvedValue({ site: 'test-site', operations: new Map() })
    mockFindOperationEntry.mockReturnValue({ protocol: 'http', operationId: 'testOp' })
    mockFetchWithRedirects.mockResolvedValue(
      new Response(JSON.stringify({ dispatched: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await dispatchOperation('test-site', 'testOp', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ dispatched: true })
  })

  it('routes WS operations through executeWsFromCli', async () => {
    mockLoadSitePackage.mockResolvedValue({ site: 'test-site', operations: new Map() })
    mockFindOperationEntry.mockReturnValue({ protocol: 'ws', operationId: 'subscribe' })
    mockExecuteWsFromCli.mockResolvedValue({ status: 200, body: { ws: true }, responseSchemaValid: true, responseHeaders: {} })

    const result = await dispatchOperation('test-site', 'subscribe', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ws: true })
  })

  it('rejects with timeout error when operation exceeds OPERATION_TIMEOUT', async () => {
    mockLoadSitePackage.mockResolvedValue({ site: 'test-site', operations: new Map() })
    mockFindOperationEntry.mockReturnValue({ protocol: 'http', operationId: 'slowOp' })

    // Mock loadOpenApi etc. to make executeOperation hang
    mockLoadOpenApi.mockImplementation(() => new Promise(() => {})) // never resolves

    await expect(dispatchOperation('test-site', 'slowOp', {})).rejects.toMatchObject({
      payload: {
        message: expect.stringContaining('timed out'),
        failureClass: 'retriable',
      },
    })
  }, 10_000)
})
