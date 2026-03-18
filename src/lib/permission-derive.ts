/**
 * Shared permission derivation from HTTP method + API path.
 * Used by the compiler (generator) module.
 */

const TRANSACT_PATTERNS = /\/(checkout|purchase|payment|order|subscribe)\b/i

export function derivePermissionFromMethod(method: string, apiPath: string): string {
  if (TRANSACT_PATTERNS.test(apiPath)) return 'transact'
  switch (method.toLowerCase()) {
    case 'delete':
      return 'delete'
    case 'post':
    case 'put':
    case 'patch':
      return 'write'
    default:
      return 'read'
  }
}
