const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Check if CSRF should be applied for this method given the configured scope */
export function shouldApplyCsrf(scope: readonly string[] | undefined, method: string): boolean {
  const upper = method.toUpperCase()
  return scope
    ? scope.some((s) => s.toUpperCase() === upper)
    : MUTATION_METHODS.has(upper)
}
