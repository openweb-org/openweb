/** Check if CSRF should be applied for this method given the configured scope */
export function shouldApplyCsrf(scope: readonly string[] | undefined, method: string): boolean {
  const upper = method.toUpperCase()
  // When scope is explicitly defined, respect it; otherwise always apply
  // (CSRF headers are harmless on GET and some sites like LinkedIn require them)
  return scope
    ? scope.some((s) => s.toUpperCase() === upper)
    : true
}
