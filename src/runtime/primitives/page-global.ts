import { OpenWebError } from '../../lib/errors.js'
import { evaluatePageExpression } from './page-expression.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface PageGlobalConfig {
  readonly expression: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
  readonly values?: ReadonlyArray<{
    readonly expression: string
    readonly inject: {
      readonly header?: string
      readonly prefix?: string
      readonly query?: string
    }
  }>
}

/**
 * Resolve page_global auth: evaluate a JS expression on the page to get a token value.
 * Supports injecting into headers or query parameters.
 * Optionally resolves multiple values (e.g., YouTube needs API_KEY + SESSION_INDEX).
 */
export async function resolvePageGlobal(
  handle: BrowserHandle,
  config: PageGlobalConfig,
): Promise<ResolvedInjections & { queryParams?: Record<string, string> }> {
  const headers: Record<string, string> = {}
  const queryParams: Record<string, string> = {}

  // Resolve primary value
  const primaryValue = await evaluateStringExpression(handle, config.expression)
  applyInject(primaryValue, config.inject, headers, queryParams)

  // Resolve additional values if specified
  if (config.values) {
    for (const extra of config.values) {
      const value = await evaluateStringExpression(handle, extra.expression)
      applyInject(value, extra.inject, headers, queryParams)
    }
  }

  return {
    headers,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  }
}

async function evaluateStringExpression(handle: BrowserHandle, expression: string): Promise<string> {
  const value = await evaluatePageExpression(handle, expression, {
    error: 'auth',
    code: 'AUTH_FAILED',
  })
  if (value === undefined || value === null) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `Page global expression "${expression}" returned no value.`,
      action: 'Ensure you are on the correct page and logged in.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  return String(value)
}

function applyInject(
  value: string,
  inject: { readonly header?: string; readonly prefix?: string; readonly query?: string },
  headers: Record<string, string>,
  queryParams: Record<string, string>,
): void {
  if (inject.header) {
    headers[inject.header] = (inject.prefix ?? '') + value
  }
  if (inject.query) {
    queryParams[inject.query] = value
  }
}

import { registerResolver } from './registry.js'
registerResolver('page_global', async (ctx, config) =>
  resolvePageGlobal(ctx.handle, config as unknown as Parameters<typeof resolvePageGlobal>[1]))
