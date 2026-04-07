import { OpenWebError } from '../lib/errors.js'
import type { XOpenWebOperation } from '../types/extensions.js'
import { getValueAtPath } from './value-path.js'

/**
 * Apply response unwrapping based on the operation's x-openweb.unwrap path.
 * If the unwrap target is null/absent and the response has a non-empty `errors`
 * array, throws OpenWebError.apiError() with the first error message (GraphQL error detection).
 */
export function applyResponseUnwrap(body: unknown, operation: { 'x-openweb'?: unknown }): unknown {
  const opExt = operation['x-openweb'] as XOpenWebOperation | undefined
  const unwrapPath = opExt?.unwrap
  if (!unwrapPath) return body

  // GraphQL error detection: check for errors array before unwrapping
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    const errors = record.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const unwrapped = getValueAtPath(body, unwrapPath)
      if (unwrapped === undefined || unwrapped === null) {
        const first = errors[0]
        const message = first && typeof first === 'object' && 'message' in first
          ? String((first as Record<string, unknown>).message)
          : JSON.stringify(first)
        throw OpenWebError.apiError('GraphQL', message)
      }
    }
  }

  return getValueAtPath(body, unwrapPath)
}
