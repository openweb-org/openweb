import { pathToFileURL } from 'node:url'
import path from 'node:path'

import type { Page } from 'playwright'

import { OpenWebError } from '../lib/errors.js'
import type { CodeAdapter } from '../types/adapter.js'

const adapterCache = new Map<string, CodeAdapter>()

/**
 * Load a CodeAdapter from the fixture/skill package's adapters/ directory.
 * Adapters are TypeScript/JavaScript modules that export a default CodeAdapter object.
 */
export async function loadAdapter(siteRoot: string, adapterName: string): Promise<CodeAdapter> {
  const cacheKey = `${siteRoot}:${adapterName}`
  const cached = adapterCache.get(cacheKey)
  if (cached) return cached

  const adapterDir = path.join(siteRoot, 'adapters')
  const candidates = [
    path.join(adapterDir, `${adapterName}.js`),
    path.join(adapterDir, `${adapterName}.ts`),
  ]

  let adapter: CodeAdapter | undefined
  for (const filePath of candidates) {
    try {
      const fileUrl = pathToFileURL(filePath).href
      const mod = await import(fileUrl) as { default?: CodeAdapter }
      if (mod.default && typeof mod.default.execute === 'function') {
        adapter = mod.default
        break
      }
    } catch {
      continue
    }
  }

  if (!adapter) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Adapter "${adapterName}" not found in ${adapterDir}`,
      action: 'Ensure the adapter file exists in the adapters/ directory.',
      retriable: false,
    })
  }

  adapterCache.set(cacheKey, adapter)
  return adapter
}

/**
 * Execute an adapter operation:
 * 1. Init (if needed)
 * 2. Check auth
 * 3. Execute operation
 */
export async function executeAdapter(
  page: Page,
  adapter: CodeAdapter,
  operation: string,
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const ready = await adapter.init(page)
  if (!ready) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Adapter "${adapter.name}" failed to initialize.`,
      action: 'Ensure the site is loaded and the page is ready.',
      retriable: true,
    })
  }

  const authenticated = await adapter.isAuthenticated(page)
  if (!authenticated) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `Adapter "${adapter.name}": not authenticated.`,
      action: 'Log in to the site and try again.',
      retriable: true,
    })
  }

  return adapter.execute(page, operation, params)
}

/** Clear the adapter cache (useful for tests) */
export function clearAdapterCache(): void {
  adapterCache.clear()
}
