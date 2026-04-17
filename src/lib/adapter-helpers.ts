import type { Page, Response as PwResponse } from 'patchright'

import { DEFAULT_USER_AGENT } from './config.js'
import { OpenWebError, getHttpFailure } from './errors.js'
import { validateSSRF } from './ssrf.js'
import { fetchWithRedirects } from '../runtime/redirect.js'
import { resolvePageGlobalData } from '../runtime/primitives/page-global-data.js'
import { parseScriptContent } from '../runtime/primitives/script-json-parse.js'
import { resolveSsrNextData } from '../runtime/primitives/ssr-next-data.js'
import type { BrowserHandle } from '../runtime/primitives/types.js'

export interface InterceptOptions {
  readonly urlMatch: string | RegExp
  readonly navigateUrl: string
  readonly timeout?: number
  readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  readonly useLocationHref?: boolean
}

export interface PageFetchOptions {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly headers?: Record<string, string>
  readonly credentials?: 'same-origin' | 'include'
  readonly timeout?: number
}

export interface PageFetchResult {
  readonly status: number
  readonly text: string
}

export interface NodeFetchOptions {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly headers?: Record<string, string>
  readonly timeout?: number
}

export interface GraphqlFetchOptions {
  readonly url: string
  readonly operationName: string
  readonly variables: Record<string, unknown>
  readonly hash?: string
  readonly query?: string
  readonly headers?: Record<string, string>
  readonly batched?: boolean
  readonly timeout?: number
}

const DEFAULT_TIMEOUT = 15_000

/**
 * Browser-context fetch with AbortController timeout.
 * Returns raw { status, text }. Throws OpenWebError on network failure.
 */
export async function pageFetch(page: Page, options: PageFetchOptions): Promise<PageFetchResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT

  const result = await page.evaluate(
    async (args: { url: string; method: string; body?: string; headers: Record<string, string>; credentials: string; timeout: number }) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), args.timeout)
      try {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.body,
          credentials: args.credentials as RequestCredentials,
          signal: controller.signal,
        })
        const text = await resp.text()
        return { status: resp.status, text }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return { status: 0, text: 'Request timed out' }
        }
        return { status: 0, text: String(err) }
      } finally {
        clearTimeout(timer)
      }
    },
    {
      url: options.url,
      method: options.method ?? 'POST',
      body: options.body,
      headers: options.headers ?? {},
      credentials: options.credentials ?? 'include',
      timeout,
    },
  )

  if (result.status === 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `pageFetch failed: ${result.text}`,
      action: 'Check network connectivity and URL.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  return result
}

/**
 * Node-context fetch for adapters that don't need a browser page.
 * SSRF-validated, timeout-guarded. Returns raw { status, text }.
 * Throws OpenWebError on network failure or blocked URL.
 */
export async function nodeFetch(options: NodeFetchOptions): Promise<PageFetchResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const headers: Record<string, string> = { 'User-Agent': DEFAULT_USER_AGENT, ...options.headers }

  try {
    const resp = await fetchWithRedirects(
      options.url,
      options.method ?? 'GET',
      headers,
      options.body,
      { fetchImpl: (u, init) => fetch(u, { ...init, signal: controller.signal }), ssrfValidator: validateSSRF },
    )
    const text = await resp.text()
    return { status: resp.status, text }
  } catch (err) {
    if (err instanceof OpenWebError) throw err
    const message = (err as Error).name === 'AbortError'
      ? 'Request timed out'
      : String(err)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `nodeFetch failed: ${message}`,
      action: 'Check network connectivity and URL.',
      retriable: true,
      failureClass: 'retriable',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GraphQL fetch via pageFetch. Builds the request body (APQ hash or query),
 * calls pageFetch, checks for errors array, returns the `data` field.
 * Throws OpenWebError on GraphQL errors or HTTP failure.
 */
export async function graphqlFetch(page: Page, options: GraphqlFetchOptions): Promise<unknown> {
  const body: Record<string, unknown> = {
    operationName: options.operationName,
    variables: options.variables,
  }

  if (options.hash) {
    body.extensions = {
      persistedQuery: { version: 1, sha256Hash: options.hash },
    }
  } else if (options.query) {
    body.query = options.query
  }

  const payload = options.batched ? JSON.stringify([body]) : JSON.stringify(body)

  const result = await pageFetch(page, {
    url: options.url,
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    timeout: options.timeout,
  })

  if (result.status >= 400) {
    const failure = getHttpFailure(result.status)
    throw new OpenWebError({
      error: failure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: failure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `GraphQL ${options.operationName}: HTTP ${result.status}`,
      action: failure.failureClass === 'needs_login'
        ? 'Log in to the site and try again.'
        : 'Check parameters and endpoint availability.',
      retriable: failure.retriable,
      failureClass: failure.failureClass,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    throw OpenWebError.apiError(`GraphQL ${options.operationName}`, 'Response is not valid JSON')
  }

  const gqlResponse = options.batched
    ? (parsed as unknown[])[0] as Record<string, unknown>
    : parsed as Record<string, unknown>

  if (gqlResponse.errors && Array.isArray(gqlResponse.errors) && gqlResponse.errors.length > 0) {
    const firstError = gqlResponse.errors[0] as Record<string, unknown>
    throw OpenWebError.apiError(
      `GraphQL ${options.operationName}`,
      (firstError.message as string) ?? 'Unknown GraphQL error',
    )
  }

  return gqlResponse.data
}

/**
 * Navigate to a URL and intercept a matching network response.
 * Registers the listener BEFORE navigation so early responses are not missed.
 * Returns the parsed JSON body of the first matching response.
 */
export async function interceptResponse(page: Page, options: InterceptOptions): Promise<unknown> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const waitUntil = options.waitUntil ?? 'load'

  const _UNSET = Symbol('unset')
  let captured: unknown = _UNSET
  const match = options.urlMatch

  const handler = async (resp: PwResponse) => {
    if (captured !== _UNSET) return
    const url = resp.url()
    const matched = typeof match === 'string' ? url.includes(match) : match.test(url)
    if (matched) {
      try { captured = await resp.json() } catch { /* ignore parse errors */ }
    }
  }

  page.on('response', handler)

  try {
    if (options.useLocationHref) {
      await Promise.all([
        page.waitForNavigation({ waitUntil, timeout: timeout + 5_000 }),
        page.evaluate((u: string) => { window.location.href = u }, options.navigateUrl),
      ])
    } else {
      await page.goto(options.navigateUrl, { waitUntil, timeout: timeout + 5_000 }).catch(() => {})
    }

    const deadline = Date.now() + timeout
    while (captured === _UNSET && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
    }
  } finally {
    page.off('response', handler)
  }

  if (captured === _UNSET) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `interceptResponse: no response matched ${String(match)} within ${timeout}ms`,
      action: 'Check URL pattern and page load behavior.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  return captured
}

/**
 * Extract SSR state from a page. `source` is either '__NEXT_DATA__' (delegates
 * to ssr_next_data logic: window global with script tag fallback) or any JS
 * expression evaluated in the page context (e.g. 'window.__INITIAL_STATE__').
 * Optional `path` is a dotted path into the resolved value.
 */
export async function ssrExtract(page: Page, source: string, path?: string): Promise<unknown> {
  const handle: BrowserHandle = { page, context: page.context() }
  if (source === '__NEXT_DATA__') {
    return resolveSsrNextData(handle, { path: path ?? '' })
  }
  return resolvePageGlobalData(handle, { expression: source, path })
}

/**
 * Extract all <script type="application/ld+json"> blocks on the page, parse
 * them, and optionally filter by `@type`. Malformed JSON blocks are skipped.
 * Returns an array (empty when nothing matches).
 */
export async function jsonLdExtract(page: Page, typeFilter?: string): Promise<unknown[]> {
  const rawScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent ?? '')
  })

  const selector = 'script[type="application/ld+json"]'
  const results: unknown[] = []
  for (const raw of rawScripts) {
    if (!raw.trim()) continue
    let parsed: unknown
    try {
      parsed = parseScriptContent(raw, selector)
    } catch {
      continue
    }
    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of items) {
      if (!typeFilter) {
        results.push(item)
        continue
      }
      const t = (item as { '@type'?: unknown })?.['@type']
      const matches = Array.isArray(t) ? t.includes(typeFilter) : t === typeFilter
      if (matches) results.push(item)
    }
  }
  return results
}

export interface DomExtractField {
  readonly selector: string
  /** 'text' (default), 'innerHTML', or 'attr:name' */
  readonly extract?: string
  /** Regex applied to the extracted value; capture group 1, else whole match. */
  readonly pattern?: string
}

export interface DomExtractSpec {
  /** When set: each matching element becomes one row; fields are queried
   *  relative to it. When absent: fields are queried against document once. */
  readonly container?: string
  readonly fields: Readonly<Record<string, DomExtractField>>
}

/**
 * Declarative DOM extraction. With `container`, returns an array of row
 * objects; without, returns a single object. Fields support text/innerHTML/
 * attribute extraction plus an optional regex refinement.
 */
export async function domExtract(
  page: Page,
  spec: DomExtractSpec,
): Promise<Record<string, string | null> | Array<Record<string, string | null>>> {
  return page.evaluate((s) => {
    const extractValue = (target: Element, extract: string, pattern?: string): string | null => {
      let value: string | null
      if (extract === 'innerHTML') value = (target as HTMLElement).innerHTML
      else if (extract.startsWith('attr:')) value = target.getAttribute(extract.slice(5))
      else value = target.textContent?.trim() ?? null
      if (value !== null && pattern) {
        const m = new RegExp(pattern).exec(value)
        value = m ? (m[1] ?? m[0]) : null
      }
      return value
    }

    const extractFields = (root: ParentNode): Record<string, string | null> => {
      const out: Record<string, string | null> = {}
      for (const [k, f] of Object.entries(s.fields)) {
        const t = root.querySelector(f.selector)
        out[k] = t ? extractValue(t, f.extract ?? 'text', f.pattern) : null
      }
      return out
    }

    if (s.container) {
      return Array.from(document.querySelectorAll(s.container)).map(extractFields)
    }
    return extractFields(document)
  }, spec as unknown as { container?: string; fields: Record<string, DomExtractField> })
}
