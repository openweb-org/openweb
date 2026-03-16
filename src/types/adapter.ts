import type { Page } from 'playwright'

export type AdapterCapability =
  | { readonly type: 'signing'; readonly description: string }
  | { readonly type: 'auth'; readonly description: string }
  | { readonly type: 'protocol'; readonly description: string }
  | { readonly type: 'extraction'; readonly description: string }

export interface CodeAdapter {
  readonly name: string
  readonly description: string
  readonly provides: readonly AdapterCapability[]

  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}
