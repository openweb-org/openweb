import type { Page } from 'patchright'

export interface CodeAdapter {
  readonly name: string
  readonly description: string

  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}
