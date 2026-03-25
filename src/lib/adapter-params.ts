import { OpenWebError } from './errors.js'

/**
 * Require a non-empty string param. Tries names in order (for aliases like podcastId/id).
 * Throws OpenWebError with INVALID_PARAMS if missing or empty.
 */
export function requireString(params: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const val = params[name]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  throw OpenWebError.missingParam(names[0])
}

/**
 * Require a valid numeric param. Tries names in order.
 * Throws OpenWebError with INVALID_PARAMS if missing or NaN.
 */
export function requireNumber(params: Record<string, unknown>, ...names: string[]): number {
  for (const name of names) {
    const val = params[name]
    if (val !== undefined && val !== null) {
      const num = Number(val)
      if (!Number.isNaN(num)) return num
    }
  }
  throw OpenWebError.missingParam(names[0])
}

/**
 * Optional string param with fallback. Returns trimmed value or fallback.
 */
export function optString(params: Record<string, unknown>, fallback: string, ...names: string[]): string {
  for (const name of names) {
    const val = params[name]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return fallback
}
