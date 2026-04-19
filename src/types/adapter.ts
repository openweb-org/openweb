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

/** Pre-resolved auth material handed to a CustomRunner. Matches the shape
 *  returned by the runtime auth-primitive resolver. */
export interface AuthResult {
  readonly headers: Readonly<Record<string, string>>
  readonly cookieString?: string
  readonly queryParams?: Readonly<Record<string, string>>
}

/** Context assembled by the runtime and handed to `CustomRunner.run()`. The
 *  runner receives fully-prepared state: a ready page (or null for
 *  transport:node), resolved auth, and an interpolated server URL. */
export interface PreparedContext {
  readonly page: Page | null
  readonly operation: string
  readonly params: Readonly<Record<string, unknown>>
  readonly helpers: AdapterHelpers
  readonly auth: AuthResult | undefined
  readonly serverUrl: string
}

/** Adapter surface: a single `run(ctx)` entry. The runtime performs page
 *  acquisition (PagePlan), auth resolution, warm-up, and post-call bot
 *  detection — the runner just executes the operation. */
export interface CustomRunner {
  readonly name: string
  readonly description: string
  run(ctx: PreparedContext): Promise<unknown>
  /** Optional per-site readiness predicate. The runtime polls this during
   *  warm-up (after navigation, before run()) until it returns true or
   *  `warmTimeoutMs` elapses. Use for SPAs whose hydration the runtime
   *  can't detect via cookies (Telegram webpack chunks + Worker entity
   *  cache, IndexedDB-backed session). Errors are swallowed — warm-up is
   *  best-effort. */
  warmReady?(page: Page): Promise<boolean>
  /** Max time to poll `warmReady` (default 15000ms). */
  warmTimeoutMs?: number
}
