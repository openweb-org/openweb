import type { Page } from 'patchright'

import type {
  DomExtractSpec,
  GraphqlFetchOptions,
  PageFetchOptions,
  PageFetchResult,
} from '../lib/adapter-helpers.js'

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
  /** Extract SSR state (__NEXT_DATA__ or a JS expression), optional dotted path. */
  ssrExtract(page: Page, source: string, path?: string): Promise<unknown>
  /** Extract all <script type="application/ld+json"> blocks, optional @type filter. */
  jsonLdExtract(page: Page, typeFilter?: string): Promise<unknown[]>
  /** Declarative DOM extraction (single object or array via `container`). */
  domExtract(page: Page, spec: DomExtractSpec): Promise<Record<string, string | null> | Array<Record<string, string | null>>>
  errors: AdapterErrorHelpers
}

export interface CodeAdapter {
  readonly name: string
  readonly description: string

  /** Optional. When absent the runtime-level PagePlan (navigation + ready
   *  selector + settle + warm) is the adapter's init. Only implement this when
   *  the adapter needs page-specific bootstrapping beyond PagePlan (e.g.
   *  priming a global variable, opening a side-panel, waiting for a dynamic
   *  element that isn't expressible as a single ready selector). */
  init?(page: Page): Promise<boolean>
  /** Optional. When absent the runtime treats "auth primitive resolves
   *  successfully" as authenticated (i.e. credentials configured, not
   *  validated). Override this for adapters that must probe for actual
   *  credential validity (e.g. fetch /me and check for login_required). */
  isAuthenticated?(page: Page): Promise<boolean>
  execute(page: Page | null, operation: string, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown>
}
