import { OpenWebError } from '../../lib/errors.js'
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
  const primaryValue = await evaluateExpression(handle, config.expression)
  applyInject(primaryValue, config.inject, headers, queryParams)

  // Resolve additional values if specified
  if (config.values) {
    for (const extra of config.values) {
      const value = await evaluateExpression(handle, extra.expression)
      applyInject(value, extra.inject, headers, queryParams)
    }
  }

  return {
    headers,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  }
}

/**
 * Blocklist of patterns that should never appear in page_global expressions.
 * Expressions come from the compiler-generated spec (trusted), but this
 * provides defense-in-depth against injection if a spec is tampered with.
 */
const BLOCKED_PATTERNS = [
  'fetch(',
  'document.cookie',
  'eval(',
  'Function(',
  'XMLHttpRequest',
  'import(',
  'require(',
  'process.',
  'globalThis.process',
  'child_process',
]

function validateExpression(expression: string): void {
  const lower = expression.toLowerCase()
  for (const pattern of BLOCKED_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Blocked page_global expression: contains disallowed pattern "${pattern}".`,
        action: 'The expression may have been tampered with. Re-capture the site.',
        retriable: false,
      })
    }
  }
}

async function evaluateExpression(handle: BrowserHandle, expression: string): Promise<string> {
  validateExpression(expression)

  /**
   * SECURITY: `new Function(\`return ${expr}\`)()` executes arbitrary JS in the
   * page context. This is by design -- page_global needs to evaluate property
   * lookups like `ytcfg.data_.INNERTUBE_API_KEY` that only exist at runtime.
   *
   * Trust boundary: expressions originate from the compiler-generated fixture/spec,
   * which is created from captured HAR data. The blocklist above provides
   * defense-in-depth against obviously malicious patterns if a spec is tampered with.
   */
  const value = await handle.page.evaluate((expr: string) => {
    try {
      return new Function(`return ${expr}`)() as unknown
    } catch {
      return undefined
    }
  }, expression)

  if (value === undefined || value === null) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `Page global expression "${expression}" returned no value.`,
      action: 'Ensure you are on the correct page and logged in.',
      retriable: true,
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
