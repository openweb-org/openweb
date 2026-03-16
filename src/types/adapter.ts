export type AdapterCapability =
  | { readonly type: 'signing'; readonly description: string }
  | { readonly type: 'auth'; readonly description: string }
  | { readonly type: 'protocol'; readonly description: string }
  | { readonly type: 'extraction'; readonly description: string }

export interface CodeAdapter {
  readonly name: string
  readonly description: string
  readonly provides: readonly AdapterCapability[]

  init(page: unknown): Promise<boolean>
  isAuthenticated(page: unknown): Promise<boolean>
  execute(page: unknown, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}
