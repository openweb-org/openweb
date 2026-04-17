import { OpenWebError } from '../../lib/errors.js'
import { resolveApolloRefs } from '../apollo-refs.js'
import { getValueAtPath } from '../value-path.js'
import { evaluatePageExpression } from './page-expression.js'
import type { BrowserHandle } from './types.js'

export interface PageGlobalDataConfig {
  readonly expression: string
  readonly path?: string
  readonly resolve_apollo_refs?: boolean
  readonly apollo_cache_path?: string
}

export async function resolvePageGlobalData(
  handle: BrowserHandle,
  config: PageGlobalDataConfig,
): Promise<unknown> {
  const globalData = await evaluatePageExpression(handle, config.expression, {
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
  })

  if (globalData === undefined || globalData === null) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Page global expression "${config.expression}" returned no value.`,
      action: 'Open the matching page and ensure the global is initialized.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  if (!config.path) {
    return maybeResolveRefs(globalData, globalData, config)
  }

  const value = getValueAtPath(globalData, config.path)
  if (value === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${config.path}" was not found in page global "${config.expression}".`,
      action: 'Update the site package path to match the current page data.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return maybeResolveRefs(value, globalData, config)
}

function maybeResolveRefs(
  value: unknown,
  root: unknown,
  config: PageGlobalDataConfig,
): unknown {
  if (!config.resolve_apollo_refs) return value
  const cacheBase = config.apollo_cache_path
    ? getValueAtPath(root, config.apollo_cache_path)
    : value
  if (!cacheBase || typeof cacheBase !== 'object') {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'Apollo cache object was not found at the configured path.',
      action: 'Verify apollo_cache_path points to the Apollo state object.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
  return resolveApolloRefs(value, cacheBase as Record<string, unknown>)
}
