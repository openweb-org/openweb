import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { BrowserContext, Page } from 'patchright'

import { OpenWebError, toOpenWebError } from '../lib/errors.js'
import { pageFetch, graphqlFetch, ssrExtract, jsonLdExtract, domExtract } from '../lib/adapter-helpers.js'
import type {
  AdapterErrorHelpers,
  AdapterHelpers,
  AuthResult,
  CustomRunner,
  PreparedContext,
} from '../types/adapter.js'
import { detectPageBotBlock } from './bot-detect.js'
import { ensurePagePolyfills } from './page-polyfill.js'
import { type PagePlan, acquirePage } from './page-plan.js'
import { warmSession } from './warm-session.js'

const adapterCache = new Map<string, CustomRunner>()

function preferTypeScriptAdapter(): boolean {
  return process.argv[1]?.endsWith('.ts') ?? false
}

/**
 * Load a CustomRunner adapter from the site package's adapters/ directory.
 * The module's default export must expose `run(ctx)`.
 * Tries .js first (production builds), then .ts (dev mode under tsx).
 */
export async function loadAdapter(siteRoot: string, adapterName: string): Promise<CustomRunner> {
  // Validate adapter name — prevent path traversal
  if (adapterName.includes('/') || adapterName.includes('\\') || adapterName.includes('..')) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Invalid adapter name: "${adapterName}"`,
      action: 'Adapter names must be simple identifiers without path separators.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const cacheKey = `${siteRoot}:${adapterName}`
  const cached = adapterCache.get(cacheKey)
  if (cached) return cached

  const adapterDir = path.join(siteRoot, 'adapters')
  const candidates = preferTypeScriptAdapter()
    ? [
        path.join(adapterDir, `${adapterName}.ts`),
        path.join(adapterDir, `${adapterName}.js`),
      ]
    : [
        path.join(adapterDir, `${adapterName}.js`),
        path.join(adapterDir, `${adapterName}.ts`),
      ]

  let adapter: CustomRunner | undefined
  let lastError: Error | undefined
  let foundFile = false
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    foundFile = true
    try {
      const fileUrl = pathToFileURL(filePath).href
      const mod = await import(fileUrl) as { default?: unknown; run?: unknown }
      const candidate = (mod.default ?? (typeof mod.run === 'function' ? mod : undefined)) as
        | Partial<CustomRunner>
        | undefined
      if (candidate && typeof candidate.run === 'function') {
        adapter = candidate as CustomRunner
        break
      }
      lastError = new Error(`${filePath}: module has no valid adapter export (expected \`run\`)`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (!adapter && lastError) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Adapter "${adapterName}" failed to load: ${lastError.message}`,
      action: 'Check adapter syntax. .ts files require tsx runtime (pnpm dev). Built mode needs .js files.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  if (!adapter) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: foundFile
        ? `Adapter "${adapterName}" has no valid adapter export in ${adapterDir}`
        : `Adapter "${adapterName}" not found in ${adapterDir}`,
      action: 'Ensure the adapter file exists and exports a CustomRunner (object with `run`).',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  adapterCache.set(cacheKey, adapter)
  return adapter
}

export interface AdapterExecOptions {
  /** When false, skip the auth-resolution step entirely. Default: true. */
  readonly requiresAuth?: boolean
  /** Eagerly resolve the spec auth primitive and hand the result to
   *  `run(ctx)`. When omitted, `ctx.auth` is undefined and the runner is
   *  expected to read credentials from the page itself. */
  readonly resolveAuthResult?: (page: Page | null) => Promise<AuthResult | undefined>
  /** Interpolated server URL exposed via `ctx.serverUrl`. */
  readonly serverUrl?: string
}

/**
 * Execute a CustomRunner: resolve auth eagerly, warm the session, invoke
 * `run(ctx)`, then apply the post-call bot-detection guard. PagePlan (runtime
 * default) already delivered a ready page; auth failures surface as real-call
 * errors inside `run`.
 */
export async function executeAdapter(
  page: Page | null,
  runner: CustomRunner,
  operation: string,
  params: Readonly<Record<string, unknown>>,
  options?: AdapterExecOptions,
): Promise<unknown> {
  const requiresAuth = options?.requiresAuth !== false
  const auth = requiresAuth && options?.resolveAuthResult
    ? await options.resolveAuthResult(page)
    : undefined

  if (page) {
    await ensurePagePolyfills(page)
    await warmSession(page, page.url())
  }

  const ctx: PreparedContext = {
    page,
    operation,
    params,
    helpers: buildHelpers(),
    auth,
    serverUrl: options?.serverUrl ?? '',
  }
  const result = await runner.run(ctx)

  if (page) {
    const botSignal = await detectPageBotBlock(page)
    if (botSignal) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Bot detection on page: ${botSignal}`,
        action: 'Solve CAPTCHA in visible browser, then retry.',
        retriable: true,
        failureClass: 'bot_blocked',
      })
    }
  }

  return result
}

const adapterErrors: AdapterErrorHelpers = {
  unknownOp: (op) => OpenWebError.unknownOp(op),
  missingParam: (name) => OpenWebError.missingParam(name),
  httpError: (status) => OpenWebError.httpError(status),
  apiError: (label, msg) => OpenWebError.apiError(label, msg),
  needsLogin: () => OpenWebError.needsLogin(),
  botBlocked: (msg) => new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED', message: msg,
    action: 'Solve CAPTCHA in visible browser, then retry.', retriable: true, failureClass: 'bot_blocked',
  }),
  fatal: (msg) => new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED', message: msg,
    action: 'Check the operation parameters.', retriable: false, failureClass: 'fatal',
  }),
  retriable: (msg) => new OpenWebError({
    error: 'execution_failed', code: 'EXECUTION_FAILED', message: msg,
    action: 'Retry the command.', retriable: true, failureClass: 'retriable',
  }),
  wrap: (err) => toOpenWebError(err),
}

/** Clear the adapter cache (useful for tests) */
export function clearAdapterCache(): void {
  adapterCache.clear()
}

function buildHelpers(): AdapterHelpers {
  return { pageFetch, graphqlFetch, ssrExtract, jsonLdExtract, domExtract, errors: adapterErrors }
}

/**
 * Acquire a page via acquirePage() and run executeAdapter on it.
 *
 * Centralizes the nav logic that previously lived in http-executor's adapter
 * branch. Caller is still responsible for transport:node shortcuts (page=null)
 * and for browser-context recovery — acquirePage expects a live context.
 */
export async function executeAdapterWithAcquire(
  context: BrowserContext,
  serverUrl: string,
  plan: PagePlan,
  adapter: CustomRunner,
  operation: string,
  params: Readonly<Record<string, unknown>>,
  options?: AdapterExecOptions,
): Promise<unknown> {
  const { page, owned } = await acquirePage(context, serverUrl, plan)
  try {
    return await executeAdapter(page, adapter, operation, params, { ...options, serverUrl })
  } finally {
    if (owned) await page.close().catch(() => {})
  }
}
