import type { BrowserContext, Page } from 'patchright'

/** Result of resolving an L2 primitive — headers and/or cookie string to inject */
export interface ResolvedInjections {
  readonly headers: Readonly<Record<string, string>>
  readonly cookieString?: string
}

/** Browser handles needed by primitive resolvers */
export interface BrowserHandle {
  readonly page: Page
  readonly context: BrowserContext
}
