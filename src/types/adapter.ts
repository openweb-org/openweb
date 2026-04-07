import type { Page } from 'patchright'

import type { PageFetchOptions, PageFetchResult, GraphqlFetchOptions } from '../lib/adapter-helpers.js'

export interface AdapterErrorHelpers {
  unknownOp(operation: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  apiError(label: string, message: string): Error
  needsLogin(): Error
  botBlocked(message: string): Error
  fatal(message: string): Error
  retriable(message: string): Error
  wrap(error: unknown): Error
}

export interface AdapterHelpers {
  pageFetch(page: Page, options: PageFetchOptions): Promise<PageFetchResult>
  graphqlFetch(page: Page, options: GraphqlFetchOptions): Promise<unknown>
  errors: AdapterErrorHelpers
}

export interface CodeAdapter {
  readonly name: string
  readonly description: string

  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown>
}
