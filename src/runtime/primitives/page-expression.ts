import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle } from './types.js'

interface BlockedExpressionError {
  readonly error: 'auth' | 'execution_failed'
  readonly code: 'AUTH_FAILED' | 'EXECUTION_FAILED'
}

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

function validateExpression(expression: string, blockedError: BlockedExpressionError): void {
  const lower = expression.toLowerCase()
  for (const pattern of BLOCKED_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      throw new OpenWebError({
        ...blockedError,
        message: `Blocked page expression: contains disallowed pattern "${pattern}".`,
        action: 'The expression may have been tampered with. Re-capture the site.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
  }
}

export async function evaluatePageExpression(
  handle: BrowserHandle,
  expression: string,
  blockedError: BlockedExpressionError,
): Promise<unknown> {
  validateExpression(expression, blockedError)

  return handle.page.evaluate((expr: string) => {
    try {
      return new Function(`return ${expr}`)() as unknown
    } catch {
      // intentional: expression evaluation failed in page context — return undefined
      return undefined
    }
  }, expression)
}
