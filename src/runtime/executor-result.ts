/** Unified result type returned by all executor functions. */
export interface ExecutorResult {
  readonly status: number
  readonly body: unknown
  readonly responseHeaders: Readonly<Record<string, string>>
}
