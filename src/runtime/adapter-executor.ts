import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Page } from 'patchright'

import { TIMEOUT } from '../lib/config.js'
import { OpenWebError, toOpenWebError } from '../lib/errors.js'
import { pageFetch, graphqlFetch } from '../lib/adapter-helpers.js'
import type { AdapterErrorHelpers, CodeAdapter } from '../types/adapter.js'
import { ensurePagePolyfills } from './page-polyfill.js'
import { warmSession } from './warm-session.js'

const adapterCache = new Map<string, CodeAdapter>()

function preferTypeScriptAdapter(): boolean {
  return process.argv[1]?.endsWith('.ts') ?? false
}

/**
 * Load a CodeAdapter from the site package's adapters/ directory.
 * Tries .js first (production builds), then .ts (dev mode under tsx).
 * Only suppresses file-not-found; surfaces real import errors.
 */
export async function loadAdapter(siteRoot: string, adapterName: string): Promise<CodeAdapter> {
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

  let adapter: CodeAdapter | undefined
  let lastError: Error | undefined
  let foundFile = false
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    foundFile = true
    try {
      const fileUrl = pathToFileURL(filePath).href
      const mod = await import(fileUrl) as { default?: CodeAdapter }
      if (mod.default && typeof mod.default.execute === 'function') {
        adapter = mod.default
        break
      }
      // File loaded but wrong shape
      lastError = new Error(`${filePath}: module has no valid CodeAdapter default export`)
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
        ? `Adapter "${adapterName}" has no valid CodeAdapter export in ${adapterDir}`
        : `Adapter "${adapterName}" not found in ${adapterDir}`,
      action: 'Ensure the adapter file exists and exports a default CodeAdapter object.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  adapterCache.set(cacheKey, adapter)
  return adapter
}

export interface AdapterExecOptions {
  /** When false, skip the isAuthenticated check. Default: true. */
  readonly requiresAuth?: boolean
}

/**
 * Execute an adapter operation:
 * 1. Init (if needed)
 * 2. Check auth (only when the spec declares auth)
 * 3. Execute operation
 */
export async function executeAdapter(
  page: Page,
  adapter: CodeAdapter,
  operation: string,
  params: Readonly<Record<string, unknown>>,
  options?: AdapterExecOptions,
): Promise<unknown> {
  await ensurePagePolyfills(page)
  let ready = await adapter.init(page)
  if (!ready) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(TIMEOUT.adapterRetry)
    ready = await adapter.init(page)
  }

  if (!ready) {
    // If the site requires auth and the adapter can't init, likely the user
    // isn't logged in (no global state bootstrapped). Classify as needs_login
    // so the auth cascade can trigger profile refresh / login flow.
    if (options?.requiresAuth !== false) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Adapter "${adapter.name}" failed to initialize — site may require login.`,
        action: 'Log in to the site and try again.',
        retriable: true,
        failureClass: 'needs_login',
      })
    }
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Adapter "${adapter.name}" failed to initialize.`,
      action: 'Ensure the site is loaded and the page is ready.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (options?.requiresAuth !== false) {
    const authenticated = await adapter.isAuthenticated(page)
    if (!authenticated) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Adapter "${adapter.name}": not authenticated.`,
        action: 'Log in to the site and try again.',
        retriable: true,
        failureClass: 'needs_login',
      })
    }
  }

  // Warm the session before executing — lets bot-detection sensors generate
  // valid cookies. Per-page WeakSet cache makes repeat calls a no-op.
  await warmSession(page, page.url())

  const result = await adapter.execute(page, operation, params, { pageFetch, graphqlFetch, errors: adapterErrors })

  // Post-execution bot detection: catch adapters that silently scrape CAPTCHA pages
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

  return result
}

/** Check the current page for common bot-detection / CAPTCHA signals. */
async function detectPageBotBlock(page: Page): Promise<string | undefined> {
  try {
    const url = page.url()

    // DataDome challenge redirect (seen on reuters, tripadvisor)
    if (url.includes('captcha-delivery.com')) return `DataDome challenge: ${url}`
    // Cloudflare challenge redirect (seen in CDP tabs)
    if (url.includes('challenges.cloudflare.com')) return `Cloudflare challenge: ${url}`

    return await page.evaluate(`
      (() => {
        const t = document.title.toLowerCase();
        // PerimeterX "Access Denied" (confirmed on goodrx)
        if (t.includes('access denied')) return 'PerimeterX: ' + document.title;
        // Cloudflare challenge pages
        if (t.includes('attention required') || t.includes('just a moment')) return 'Cloudflare: ' + document.title;

        // PerimeterX press-and-hold CAPTCHA container
        if (document.querySelector('#px-captcha')) return 'PerimeterX CAPTCHA';
        // DataDome CAPTCHA iframe
        if (document.querySelector('iframe[src*="captcha-delivery.com"]')) return 'DataDome CAPTCHA';

        return null;
      })()
    `) ?? undefined
  } catch {
    return undefined // page detached or navigation in progress
  }
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
